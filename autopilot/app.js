var jsnx = require('jsnetworkx');
const lightning_client = require('../lightning-client-js');
var lightning = new lightning_client("/root/.lightning", true);
var Autopilot = require('./autopilot');

//Get real node balance from c-lightning internal tracker
function cli_node_balance()
{
	return new Promise((resolve, reject) => {
		lightning.listfunds().then((funds) => {
			let outputSum = 0;
			let channelSum = 0;
			for(let x of funds.outputs)
				if(x.status == "confirmed")
					outputSum += x.value;
			for(let x of funds.channels)
				channelSum += x.channel_sat;
			resolve({outputs: outputSum, channels: channelSum});
		});
	});
}

async function run_autopilot(num_items, percentile)
{
	var balance = await cli_node_balance();
	console.log("\n\nAvailable CLN balance = ", balance);
	var wallet_balance = balance.outputs/2;
	var G = new jsnx.Graph();
	var autopilot = new Autopilot(lightning, G);
	var seed_nodes = await autopilot.get_seed_nodes();
	await autopilot.connect_seed_nodes(seed_nodes);
	var num_peers = 0;
	await lightning.listpeers().then((listpeers) => {
		num_peers = listpeers.peers.length;
		console.log("!#! Number of peers = ", num_peers);
	}).catch((err) => {
		console.log("!#! Error getting peers on startup...");
	});
	if(num_peers <= 1)
	{
		autopilot.naive_fund(wallet_balance);
	}
	else
	{
	await autopilot.populate_graph();
	var candidates = await autopilot.find_candidates(num_items, percentile);
	var stats_pdf = await autopilot.calculate_statistics(candidates, wallet_balance);
	var connection_dictionary = await autopilot.calculate_proposed_channel_capacities(stats_pdf, wallet_balance);
	autopilot.fund(connection_dictionary, wallet_balance);
	}
}

var num_items = 100;
var percentile = 0.9;

run_autopilot(num_items, percentile);
