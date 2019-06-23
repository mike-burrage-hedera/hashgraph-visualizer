function median(en) {
	var s = en.slice(0);
	s.sort(function(a, b) { return a - b; });
	return (0 === s.length) ? 0 : s[Math.floor(s.length / 2)];
}

/**
 * HashgraphEvent
 * @param nodeId - node ID that this event was created by
 * @param eventId - globally unique event ID (to simplify this visualizer)
 * @param timestamp
 * @param parent
 * @param selfParent
 * @constructor
 */
function HashgraphEvent(nodeId, eventId, timestamp, parent, selfParent) {
	if (undefined === parent) parent = null;
	if (undefined === selfParent) selfParent = null;

	this.nodeId = nodeId;
	this.eventId = eventId;
	this.timestamp = timestamp; // When the event was actually generated.

	this.parent = parent; // HashgraphEvent, or parent event ID (string/number) in the case of necessary late binding.
	this.selfParent = selfParent;

	this.round = (null === selfParent) ? 1 : null;
	this.roundReceived = null;
	this.witness = (null === selfParent);
	this.famous = false;
	this.consensusTimestamp = null;

	this.visualId = null;
	this.visualElement = null;
}

HashgraphEvent.prototype.__defineGetter__('eventType', function() {
	if (this.witness) {
		return this.famous ? 'famous witness' : 'witness';
	} else {
		return 'non-witness';
	}
});

HashgraphEvent.prototype.__defineGetter__('parentEventId', function() {
	var p = this.parent;
	if (null === p) return null;
	if (p.constructor !== HashgraphEvent) return p;
	return p.eventId;
});

/**
 * HashgraphNode
 * @param nodeId
 * @param nodeIds
 * @constructor
 */
function HashgraphNode(nodeId, nodeIds) {
	var _me = this;

	this.cytoscape = cytoscape({
		container: document.getElementById('graph-' + nodeId),
		userZoomingEnabled: false,
		elements: [],
		style: [{
			selector: 'node',
			style: {
				'background-color': '#666', // Non-witness
				'label': 'data(id)'
			}
		}, {
			selector: 'edge',
			style: {
				'width': 3,
				'line-color': '#ccc',
				'target-arrow-color': '#ccc',
				'target-arrow-shape': 'triangle'
			}
		}, {
			selector: '.final', // Non-witness, final
			style: {
				'background-color': '#000'
			}
		}, {
			selector: '.witness', // Witness
			style: {
				'background-color': '#0a0'
			}
		}, {
			selector: '.witness.final', // Witness, final
			style: {
				'background-color': '#080'
			}
		}, {
			selector: '.famous.witness', // Famous witness
			style: {
				'background-color': '#00f'
			}
		}, {
			selector: '.famous.witness.final', // Famous witness, final
			style: {
				'background-color': '#008'
			}
		}],
		layout: {
			name: 'preset',
			positions: _me.positionVisualElement
		}
	});

	this.cytoscape.on('tap', 'node', function(evt) {
		var ve = evt.target;
		var h = ve.data().internal;
		var text = 'On node ' + _me.nodeId + ': Event ' + ve.id() + ': ' + h.eventId + ' ' + h.eventType;
		if (null !== h.round) {
			text = text + ' round=' + h.round;
		}
		if (null !== h.roundReceived) {
			text = text + ' round_received=' + h.roundReceived;
		}
		if (null !== h.consensusTimestamp) {
			text = text + ' consensus_timestamp=' + h.consensusTimestamp;
		}
		if (null !== h.timestamp) {
			text = text + ' timestamp=' + h.timestamp;
		}
		hashgraph.displayEventInfo(text);
		return true;
	});

	this.maxRound = 1;
	this.nodeId = nodeId;
	this.graph = {};
	this.eventsById = {};
	$.each(nodeIds,function(_, el) {
		_me.graph[el] = [];
	});

	return this;
}

HashgraphNode.prototype.destroy = function() {
	this.cytoscape.destroy();
	this.cytoscape = null;
	return this;
};

HashgraphNode.prototype.positionVisualElement = function(ve) {
	var evt = ve.data().internal;
	var ts = evt.timestamp;
	var xi = evt.nodeId.charCodeAt(0);
	var x = 40 + ((xi - 'a'.charCodeAt(0)) * 80);
	var y = 350 - (ts * 50);
	return {x:x, y:y};
};

HashgraphNode.prototype.getEventById = function(eventId) {
	var evt = this.eventsById[eventId];
	return (undefined === evt) ? eventId : evt;
};

HashgraphNode.prototype.addEvent = function(nodeId, eventId, timestamp, parentEventId) {
	var eventSelfGraph = this.graph[nodeId];
	var eventSelfNumber = eventSelfGraph.length;
	var selfParent = eventSelfGraph.slice(-1)[0];
	var parent = this.getEventById(parentEventId);
	var evt = new HashgraphEvent(nodeId, eventId, timestamp, parent, selfParent);
	selfParent = evt.selfParent;
	eventSelfGraph.push(evt);
	this.eventsById[eventId] = evt;

	evt.visualId = nodeId + eventSelfNumber;
	var visualElement = {
		data:{
			id: evt.visualId,
			internal: evt
		},
		grabbable: false
	};
	visualElement = this.cytoscape.add(visualElement);
	visualElement.position(this.positionVisualElement(visualElement));
	evt.visualElement = visualElement;

	if (null !== selfParent) {
		this.cytoscape.add({
			data:{
				id: selfParent.visualId + evt.visualId,
				source: selfParent.visualId,
				target: evt.visualId
			}
		});
	}

	if ((null !== parent) && (undefined !== parent) && (HashgraphEvent === parent.constructor)) {
		this.drawParentLink(evt);
	}

	return evt;
};

HashgraphNode.prototype.drawParentLink = function(evt) {
	this.cytoscape.add({
		data:{
			id: evt.parent.visualId + evt.visualId,
			source: evt.parent.visualId,
			target: evt.visualId
		}
	});
};

HashgraphNode.prototype.addSelfEvent = function(eventId, timestamp, parentEventId) {
	return this.addEvent(this.nodeId, eventId, timestamp, parentEventId);
};

/**
 * Late binding draws the newly added graph connections to non-self parent events _after_ all events are added.
 * @returns {HashgraphNode}
 */
HashgraphNode.prototype.bindLate = function() {
	for (var nodeId in this.graph) {
		var g = this.graph[nodeId];
		for (var i = 0; i < g.length; ++i) {
			var evt = g[i];
			if ((null !== evt.parent) && (HashgraphEvent !== evt.parent.constructor)) {
				var newp = this.eventsById[evt.parent];
				if (undefined !== newp) {
					evt.parent = newp;
					this.drawParentLink(evt);
				}
			}
		}
	}
	return this;
};

HashgraphNode.prototype.recursiveGraphToList = function(traversed, list, gn) {
	if (null == gn) return;
	if (null != gn.selfParent) this.recursiveGraphToList(traversed, list, gn.selfParent);
	if (null != gn.parent) this.recursiveGraphToList(traversed, list, gn.parent);
	if (!traversed.has(gn.eventId)) {
		list.push(gn);
		traversed.add(gn.eventId);
	}
	return;
};

HashgraphNode.prototype.graphToListRoundsConsidered = function() {
	var list = this.graphToList();
	var results = [];
	var rounds = Array.from(new Set(list.map(function(f) { return f.round; })));
	for (var ri = 0; ri < rounds.length; ++ri) {
		var round = rounds[ri];
		results = results.concat(list.filter(function (f) {
			return f.round == round;
		}));
	}
	return results;
};

HashgraphNode.prototype.graphToList = function() {
	var traversed = new Set();
	var list = [];
	for (var k in this.graph) {
		var gn = this.graph[k];
		this.recursiveGraphToList(traversed, list, gn[gn.length - 1]);
	}
	return list;
};

HashgraphNode.prototype.canSee = function(a, b) {
	if (a === b) return true;
	if ((null !== a.selfParent) && this.canSee(a.selfParent, b)) return true;
	if ((null !== a.parent) && this.canSee(a.parent, b)) return true;
	return false;
};

HashgraphNode.prototype.recursiveCanStronglySee = function(a, b, nodePath) {
	if (null == a) return [];
	var nodePath = nodePath.concat([a.nodeId]);
	if (a === b) return nodePath;
	results = this.recursiveCanStronglySee(a.selfParent, b, nodePath);
	results = results.concat(this.recursiveCanStronglySee(a.parent, b, nodePath));
	return results;
};

HashgraphNode.prototype.canStronglySee = function(a, b) {
	if ((null === a) || (null === b)) return false;
	nodesSeeing = this.recursiveCanStronglySee(a.selfParent, b, []);
	nodesSeeing = nodesSeeing.concat(this.recursiveCanStronglySee(a.parent, b, []));
	return (new Set(nodesSeeing).size * 3) >= (Object.keys(this.graph).length * 2);
};

HashgraphNode.prototype.getRoundRWitnesses = function(r) {
	return Object.values(this.eventsById).filter(function(evt) {
		return (evt.witness && (r === evt.round));
	});
};

HashgraphNode.prototype.stronglySeenRoundRWitnesses = function(x, r) {
	var _me = this;
	return this.getRoundRWitnesses(r).filter(function(evt) {
		return _me.canStronglySee(x, evt);
	});
};

HashgraphNode.prototype.stronglySeesRoundRWitnesses = function(x, r) {
	var c = Object.keys(this.graph).length;
	var v = this.stronglySeenRoundRWitnesses(x, r).length;
	return (v * 3) >= (c * 2)
};

HashgraphNode.prototype.divideRounds = function() {
	var g2l = this.graphToList();
	for (var i = 0; i < g2l.length; ++i) {
		var x = g2l[i];
		var r = 1;
		if ((null !== x.parent) && (x.parent.round > r)) r = x.parent.round;
		if ((null !== x.selfParent) && (x.selfParent.round > r)) r = x.selfParent.round;

		if (this.stronglySeesRoundRWitnesses(x, r)) {
			x.round = r + 1;
		} else {
			x.round = r;
		}
		if (x.round > this.maxRound) {
			this.maxRound = x.round;
		}
		if (null == x.selfParent) {
			x.witness = true;
		} else {
			x.witness = (x.round > x.selfParent.round);
		}
		if (x.witness) x.visualElement.addClass('witness');
	}
};

HashgraphNode.prototype.decideFame = function() {
	var c = Object.keys(this.graph).length;
	var list = this.graphToListRoundsConsidered();
	for (var i = 0; i < list.length; ++i) {
		var x = list[i];
		if (!x.witness) {
			continue;
		}
		x.famous = null;
		var votes = {}; // eventId => true/false
		for (var j = 0; j < list.length; ++j) {
			var y = list[j];
			if (y.witness && (y.round > x.round)) {
				var d = y.round - x.round;
				var s = this.stronglySeenRoundRWitnesses(y, y.round - 1).map(function(evt) { return evt.eventId; });
				var vx = Object.keys(votes).filter(function(f) { return s.includes(+f);}).map(function(l) { return votes[+l]; });
				var v = (vx.filter(function(vote) { return vote; }).length * 2) >= s.length; // s majority vote (true preferred)
				var t = vx.filter(function(vote) { return vote == v; }).length;
				if (1 === d) {
					votes[y.eventId] = this.canSee(y, x);
				} else if ((d % c) != 0) {
					if ((t * 3) >= (2 * c)) {
						x.famous = v;
						if (x.famous) x.visualElement.addClass('famous');

						votes[y.eventId] = v;
						break;
					} else {
						votes[y.eventId] = v;
					}
				} else { // Coin round
					if ((t * 3) >= (2 * c)) {
						votes[y.eventId] = v;
					} else {
						votes[y.eventId] = ((y.eventId % 2) != 0);
					}
				}
			}
		}
	}
};

HashgraphNode.prototype.findOrder = function() {
	var list = this.graphToListRoundsConsidered();
	for (var i = 0; i < list.length; ++i) {
		var x = list[i];
		if (null !== x.roundReceived) continue;
		for (var r = 1; r <= this.maxRound; ++r) {
			var famousWitnesses = this.getRoundRWitnesses(r).filter(function(evt) {
				return evt.famous;
			});
			if (0 === famousWitnesses.length) break;
			var timestamps = [];
			for (var w = 0; w < famousWitnesses.length; ++w) {
				var fw = famousWitnesses[w];
				var ts = null;
				var e = fw;
				while ((e !== null) && (e.timestamp >= x.timestamp)) {
					if (!this.canSee(e, x)) break;
					ts = e.timestamp;
					e = e.selfParent;
				}
				if (null !== ts) timestamps.push(ts);
			}
			if (timestamps.length === famousWitnesses.length) {
				x.roundReceived = r;
				x.consensusTimestamp = median(timestamps);
				x.visualElement.addClass('final');
				break;
			}
		}
	}
};

HashgraphNode.prototype.runConsensus = function() {
	this.divideRounds();
	this.decideFame();
	this.findOrder();
	return this;
};

HashgraphNode.prototype.syncTo = function(otherNode, eventId, timestamp) {
	for (var nodeId in this.graph) {
		var otherNodeGraph = otherNode.graph[nodeId];
		var myNodeGraph = this.graph[nodeId];
		if (myNodeGraph.length > otherNodeGraph.length) {
			var addThese = myNodeGraph.slice(otherNodeGraph.length - myNodeGraph.length);
			for (var i = 0; i < addThese.length; ++i) {
				var evt = addThese[i];
				otherNode.addEvent(nodeId, evt.eventId, evt.timestamp, evt.parentEventId);
			}
		}
	}
	otherNode.addSelfEvent(eventId, timestamp, this.graph[this.nodeId].slice(-1)[0].eventId);
	otherNode.bindLate();
	otherNode.runConsensus();
	return this;
};

/**
 * Hashgraph Swrlds consensus algorithm visualizer.
 * @returns {Hashgraph}
 * @constructor
 */
function Hashgraph() {
	var _me = this;

	var $_setNodeCountSelect;
	var $_setNodeCountButton;
	var $_addRecordButton;
	var $_addRecordToSelect;
	var $_nodeSelects;
	var $_syncFromSelect;
	var $_syncToSelect;
	var $_syncButton;
	var $_tabsSection;
	var $_eventInfo;
	var _nodes = {};
	var _runningEventId = 0;
	var _runningTimestamp = 0;

	this.syncTo = function(fromNodeId, toNodeId) {
		_nodes[fromNodeId].syncTo(_nodes[toNodeId], _runningEventId++, _runningTimestamp++);
		this.scrollToTopOfGraph();
		return this;
	};

	this.addEvent = function(nodeId, parentNodeId) {
		var evt = _nodes[nodeId].addSelfEvent(_runningEventId++, _runningTimestamp++);
		this.scrollToTopOfGraph();
		return evt;
	};

	this.getNextEventId = function() {
		return _runningEventId;
	};

	this.getNodeIds = function() {
		return Object.keys(_nodes);
	};

	this.getNode = function(nodeId) {
		return _nodes[nodeId];
	};

	this.scrollToTopOfGraph = function() {
		$.each(this.getNodeIds(), function(_, nodeId) {
			setTimeout(function() {
				_nodes[nodeId].cytoscape.pan({x: 0, y: (_runningEventId * 50) - 500});
				return true;
			}, 0);
		});
		return this;
	};

	this.displayEventInfo = function(text) {
		$_eventInfo.text(text);
		return this;
	};

	/**
	 * Set the number of nodes in the visualizer (3 - 12).
	 * @param count
	 * @returns {Hashgraph}
	 */
	this.setNodeCount = function(count) {
		var count = Math.abs(+count);
		if (count < 3) count = 3;
		if (count > 12) count = 12;

		$.each(_nodes, function(_, v) {
			v.destroy();
		});

		var nodeIds = [];
		var acc = 'a'.charCodeAt(0);
		for (var i = 0; i < count; ++i) {
			nodeIds.push(String.fromCharCode(i + acc));
		}

		_nodes = {};
		_runningEventId = 0;
		_runningTimestamp = 0;

		// Clear the UI
		$_tabsSection.empty();
		$_nodeSelects.empty();

		// Fill in the select boxes and tab list.
		var $tabList = $('<ul>');
		$_tabsSection.append($tabList);
		$.each(nodeIds, function(_, nodeId) {
			var $option = $('<option/>', {
				value: nodeId,
				text: nodeId
			});
			var $tabAnchor = $('<a/>', {
				href: '#tab-' + nodeId
			}).text(nodeId);
			var $tabLink = $('<li/>').append($tabAnchor);
			$_nodeSelects.append($option);
			$tabList.append($tabLink);
		});
		$_syncToSelect.val('b');

		// Create the tab views.
		$.each(nodeIds, function(_, nodeId) {
			var $tabView = $('<div/>', {
				class: 'tabview',
				id: 'tab-' + nodeId
			}).append($('<div/>', {
				class: 'graphview',
				id: 'graph-' + nodeId
			}));
			$_tabsSection.append($tabView);
		});

		// Add the initial event to each node (for each node).
		$.each(nodeIds, function(_, nodeId) {
			var node = new HashgraphNode(nodeId, nodeIds);
			_nodes[nodeId] = node;
			for (var j = 0; j < count; ++j) {
				node.addEvent(String.fromCharCode(j + acc), j, 0);
			}
		});
		_runningEventId = count;
		_runningTimestamp = 1;

		if ($_tabsSection.hasClass('ui-tabs')) {
			$_tabsSection.tabs('destroy');
		}
		$_tabsSection.tabs({
			activate: function() {
				// After showing a cytoscape tab - it won't populate until a resize event occurs.
				window.dispatchEvent(new Event('resize'));
				return true;
			},
			active: 0
		});

		return _me;
	};

	var _onAddEventButtonClick = function() {
		event.preventDefault();
		_me.addEvent($_addRecordToSelect.val());
		return false;
	};

	var _onSyncToButtonClick = function() {
		event.preventDefault();
		var fromNodeId = $_syncFromSelect.val();
		var toNodeId = $_syncToSelect.val();
		if (fromNodeId != toNodeId) {
			_me.syncTo(fromNodeId, toNodeId);
		}
		return false;
	};

	var _init = function () {
		$_setNodeCountSelect = $('#set-node-count-select');
		for (var i = 3; i <= 12; ++i) {
			$_setNodeCountSelect.append($('<option>', {value: i, text: '' + i + ' nodes'}));
		}
		$_setNodeCountButton = $('#set-node-count-button');
		$_setNodeCountButton.click(function () {
			event.preventDefault();
			hashgraph.setNodeCount(+($_setNodeCountSelect.val()));
			return true;
		});

		$_addRecordToSelect = $('#add-record-to-select');
		$_addRecordButton = $('#add-record-button');
		$_addRecordButton.unbind('click').click(_onAddEventButtonClick);

		$_syncFromSelect = $('#sync-from-select');
		$_syncToSelect = $('#sync-to-select');
		$_syncButton = $('#sync-button');
		$_syncButton.unbind('click').click(_onSyncToButtonClick);

		$_tabsSection = $('#tabs');
		$_nodeSelects = $('.node-select');

		$_eventInfo = $('#event-info');

		return _me;
	};

	$(document).ready(_init);

	return _me;
}
var hashgraph = new Hashgraph();

$(document).ready(function() {
	hashgraph.setNodeCount(4);

	setTimeout(function() {
		var defaultGraph = ['bd', 'db', 'bd', 'cb', 'ba', 'bd', 'bc', 'db',
			'ad', 'da', 'db', 'ca', 'bd', 'ac', 'ba', 'ad', 'ab',
			'db', 'bd', 'ba', 'ab', 'cd', 'dc', 'ab', 'ba', 'db', 'ba', 'ab', 'bd',
			'cd', 'db'
		];
		$.each(defaultGraph, function (i, el) {
			setTimeout(function() {
				hashgraph.syncTo(el[0], el[1]);
				return true;
			}, 0);
		});
		return true;
	}, 0);
	return true;
});
