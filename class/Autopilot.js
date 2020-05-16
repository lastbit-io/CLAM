var dig = require('node-dig-dns');
var bech32 = require('bech32');
var jsnx = require('jsnetworkx'); 

function shuffle(array) {
	array.sort(() => Math.random() - 0.5);
}

function toHexString(byteArray) 
{
	return Array.prototype.map.call(byteArray, function(byte) {
		return ('0' + (byte & 0xFF).toString(16)).slice(-2);
	}).join('');
}

const promiseTimeout = function (ms, promise) {
	// Create a promise that rejects in <ms> milliseconds
	let timeout = new Promise((resolve, reject) => {
		let id = setTimeout(() => {
			clearTimeout(id);
			reject('Timed out in ' + ms + 'ms')
		}, ms);
	});

	// Returns a race between our timeout and the passed in promise
	return Promise.race([
		promise,
		timeout
		]);
}

export class Autopilot {

	constructor(lightning, G) 
	{
		this._lightning = lightning;
		this.G = G;
	}

	get_seed_nodes()
	{
		var node_ids = [];
		console.log("\n\n### Fetching seed nodes...\n\n");
		return new Promise((resolve, reject) => {
			dig(['lseed.bitcoinstats.com', 'SRV'])
			.then((result) => {
				for(let i of result.answer)
					node_ids.push(toHexString(bech32.fromWords((bech32.decode(i.value.split('.')[0]).words))));
				console.log("\n\n### Got seed nodes = ", node_ids + "\n\n");
				resolve(node_ids);
			})
			.catch((err) => {
				console.log('Error getting seed nodes = ', err);
				reject(err);
			});
		});
	}

	connect_to_node(node) {
		return new Promise((resolve, reject) => {
			this._lightning.connect(node).then(ok => {
				console.log("\nSuccessfully connected to node... ", ok);
				resolve(ok);
			}).catch(err => {
				console.log("\nError connecting to node... ", err);
				resolve(err);
			});
		});
	}

	connect_seed_nodes(seed_nodes)
	{
		shuffle(seed_nodes);
		console.log("\n\n### Connecting to seed nodes...\n\n");
		return new Promise(async (resolve, reject) => {
			for(let i of seed_nodes)
			{
				console.log("Connecting to node ", i);
				let connectionAttempt = promiseTimeout(3000, this.connect_to_node(i));
				await connectionAttempt.then((node) => {
					console.log("Connected to ", node)
				}).catch((err) => {
					console.log("Error connecting ", err);
				});
			}
			resolve();
		});
	}

	populate_graph()
	{
		console.log("\n\n### Creating network graph...\n\n");
		return new Promise(async (resolve, reject) => {
			console.log("\n\n### Checking peers (listpeers)...\n\n");
			await this._lightning.listpeers().then(async (peers) => {
				if(peers.length <= 1) await this.get_seed_nodes().then(async (nodes) => {
					await this.connect_seed_nodes(nodes);
				});
			}).catch((err) => {
				reject(err);
			});
			console.log("\n\n### Fetching nodes (listnodes)...\n\n");
			await this._lightning.listnodes().then((listnodes) => {
				for(let i of listnodes.nodes)
					this.G.addNode(i.nodeid, i);
			}).catch((err) => {
				reject(err);
			});
			console.log("\n\n### Fetching channels (listchannels)...\n\n");
			await this._lightning.listchannels().then((listchannels) => {
				for(let i of listchannels.channels)
					this.G.addEdge(i.source, i.destination, i);
			}).catch((err) => {	
				reject(err);
			});
			console.log("\n\n### Graph constructed\n\n");
			resolve(this.G);
		});
	}

	manipulate_pdf(pdf, skew, smooth)
	{
		return new Promise((resolve, reject) => {
			if(!skew && !smooth) return pdf;
			if(skew){
				for(var node in pdf)
					pdf[node] = Math.pow(pdf[node], 2);
				var sum = 0;
				for(var node in pdf)
					sum += pdf[node];
				for(var node in pdf)
					pdf[node] = pdf[node]/sum;
				resolve(pdf);
			}
			if(smooth){
				for(var node in pdf)
					pdf[node] = pdf[node] * 0.5 + 0.5 / Object.keys(pdf).length;
				resolve(pdf);
			}
		});
	}

	get_uniform_pdf()
	{
		console.log("\n\n### Getting uniform pdf...\n\n");
		return new Promise((resolve, reject) => {
			var len = this.G.nodes().length;
			var uniform_pdf = {};
			for(let node of this.G.nodes())
				uniform_pdf[node] = 1/len;
			console.log("\n\n### Got uniform pdf...\n\n");
			resolve(uniform_pdf);
		});
	}

	get_centrality_pdf()
	{
		console.log("\n\n### Getting centrality pdf...\n\n");
		return new Promise((resolve, reject) => {
			var cumulative_sum = 0;
			var centrality_pdf = {};
			var scores = jsnx.betweennessCentrality(this.G);
			for(var [node, score] of scores)
			{
				centrality_pdf[node] = score;
				cumulative_sum += score;
			}
			for (var node in centrality_pdf)
				centrality_pdf[node] = centrality_pdf[node]/cumulative_sum;
			console.log("\n\n### Got centrality pdf...\n\n");
			resolve(centrality_pdf);
		});
	}

	get_rich_nodes_pdf()
	{
		console.log("\n\n### Getting rich node pdf...\n\n");
		return new Promise((resolve, reject) => {
			var rich_nodes_pdf = {};
			var candidates = [];
			var network_capacity = 0;
			for(var node of this.G.nodes()){
				var total_capacity = 0;
				for(var neighbor of this.G.neighbors(node))
					total_capacity += this.G.getEdgeData(node, neighbor).satoshis;
				network_capacity += total_capacity;
				rich_nodes_pdf[node] = total_capacity;
			}
			for(var node in rich_nodes_pdf)
				rich_nodes_pdf[node] = rich_nodes_pdf[node]/network_capacity;
			console.log("\n\n### Got rich node pdf...\n\n");
			resolve(rich_nodes_pdf);
		});
	}

	get_long_path_pdf()
	{
		console.log("\n\n### Getting long path pdf...\n\n");
		return new Promise((resolve, reject) => {
			var path_pdf = {};
			var all_pair_shortest_path_lengths = jsnx.allPairsShortestPathLength(this.G);
			for(var [node, paths] of all_pair_shortest_path_lengths)
			{
				var path_sum = 0;
				for(var [i, length] of paths)
					path_sum += length;
				path_pdf[node] = path_sum;
			}
			var s = 0;
			for(node in path_pdf)
				s += path_pdf[node];
			for(node in path_pdf)
				path_pdf[node] = path_pdf[node]/s;
			console.log("\n\n### Got long path pdf...\n\n");
			resolve(path_pdf);
		});
	}

	create_pdfs()
	{
		console.log("\n\n### Calculating pdfs...\n\n");
		return new Promise(async (resolve, reject) => {
			var res = {};
			res["path"] = await this.get_long_path_pdf();
			res["centrality"] = await this.get_centrality_pdf();
			res["rich"] = await this.get_rich_nodes_pdf();
			res["uniform"] = await this.get_uniform_pdf();
			console.log("\n\n### Calculated pdfs!\n\n");
			resolve(res);
		});
	}

	fisher_yates_shuffle(arr, size) 
	{
		console.log("\n### Random sample with fisher yates...\n");
		if(size > arr.length) size = arr.length;
		return new Promise((resolve, reject) => {
			var shuffled = arr.slice(0), i = arr.length, temp, index;
			while (i--) {
				index = Math.floor((i + 1) * Math.random());
				temp = shuffled[index];
				shuffled[index] = shuffled[i];
				shuffled[i] = temp;
			}
			resolve(shuffled.slice(0, size));
		});
	}

	sample_from_pdf(pdf, num_items = 21)
	{
		console.log("\n### Sampling from pdf...\n");
		return new Promise(async (resolve, reject) => {
			var pdf_arr = [];
			Object.keys(pdf).map((key) => {
				pdf_arr.push(key);
			});
			var random_choice = await this.fisher_yates_shuffle(pdf_arr, num_items);
			resolve(random_choice);
		});
	}

	sample_from_percentile(pdf, percentile = 0.5, num_items = 21)
	{
		console.log("\n### Sampling by percentile...\n");
		return new Promise(async (resolve, reject) => {
			var cumulative_sum = 0;
			var used_pdf = {};

			var sorted_pdf_arr = Object.keys(pdf).map(function(key) {
				return [key, pdf[key]];
			});

			sorted_pdf_arr.sort(function(first, second) {
				return second[1] - first[1];
			});
			for(let node of sorted_pdf_arr)
			{
				cumulative_sum += node[1];
				used_pdf[node[0]] = node[1];
				if(cumulative_sum > percentile) break;
			}
			for(let node in used_pdf)
				used_pdf[node] = used_pdf[node]/cumulative_sum;
			var sampled_pdf = await this.sample_from_pdf(used_pdf, num_items);
			resolve(sampled_pdf);
		});
	}

	find_candidates(num_items = 21, percentile = 0.5)
	{
		console.log("\n\n### Finding node candidates...\n\n");
		return new Promise(async (resolve, reject) => {
			var res = await this.create_pdfs();
			var candidates = [];
			var sub_k = Math.ceil(num_items / 4);
			for(var strategy in res)
			{
				var tmp = await this.sample_from_percentile(res[strategy], percentile, sub_k);
				candidates = candidates.concat(tmp);
			}
			if(candidates.length > num_items)
			{
				var random_choice = await this.fisher_yates_shuffle(candidates, num_items);
				resolve(random_choice);
			}
			console.log("\n\n### Found candidates =", candidates, "\n\n");
			resolve(candidates);
		});
	}	

	calculate_statistics(candidates)
	{
		return new Promise((resolve, reject) => {
			var pdf = {};
			for(let candidate of candidates)
			{
				var neighbors = this.G.neighbors(candidate);
				var capacity = 0;
				for(var neighbor of neighbors)
					capacity += this.G.getEdgeData(candidate, neighbor).satoshis;
				var average = capacity / (1 + neighbors.length);
				pdf[candidate] = average;
			}
			var cumulative_sum = 0;
			for(let node in pdf)
				cumulative_sum += pdf[node];
			for(let node in pdf)
				pdf[node] = pdf[node] / cumulative_sum;
			var w = 0.7;
			var res_pdf = {};
			console.log("percentage   smoothed percentage    capacity    numchannels     alias");
			console.log("----------------------------------------------------------------------");
			for(let node in pdf)
			{
				var neighbors = this.G.neighbors(node);
				var capacity = 0;
				for(var neighbor of neighbors)
					capacity += this.G.getEdgeData(node, neighbor).satoshis;
				console.log("%f       %f                      %d   %d  %s", (100 * pdf[node]).toFixed(2), (100 * (w * pdf[node] + (1 - w) / candidates.length)).toFixed(2), capacity, neighbors.length, node);
				res_pdf[node] = (w * pdf[node] + (1 - w) / candidates.length);
			}
			resolve(res_pdf);
		});
	}

	calculate_proposed_channel_capacities(pdf, balance = 1000000)
	{
		return new Promise((resolve, reject) => {
			var minimal_channel_balance = 20000;
			var pdf_arr = [];
			Object.keys(pdf).map((key) => {
				pdf_arr.push(pdf[key]);
			});
			var min_probability = Math.min(pdf_arr);
			var needed_total_balance = Math.ceil(minimal_channel_balance/min_probability);
			while(needed_total_balance > balance && Object.keys(pdf).length > 1) 
			{
				var temp_pdf_arr = [];
				Object.keys(pdf).map((key) => {
					temp_pdf_arr.push(pdf[key]);
				});
				var min_val = Math.min(temp_pdf_arr);
				for(let node in pdf)
				{
					if(pdf[node] == min_val)
						delete pdf[node];
				}
				let sum = 0;
				for(let node in pdf)
					sum += pdf[node];
				for(let node in pdf)
					pdf[node] = pdf[node] / sum;

				temp_pdf_arr = [];
				Object.keys(pdf).map((key) => {
					temp_pdf_arr.push(pdf[key]);
				});
				min_val = Math.min(temp_pdf_arr);
				needed_total_balance = Math.ceil(minimal_channel_balance / min_val);
			}
			resolve(pdf);
		});
	}

	async fund(nodes, balance)
	{
		for(let node in nodes)
		{
			var sats = Math.ceil(nodes[node] * balance);
			console.log("\n\n###Connecting to node %s to fund channel...", node);
			let connectionAttempt = promiseTimeout(5000, this.connect_to_node(node));
			await connectionAttempt.then((connected_node) => {
				if(connected_node.id != undefined)
					console.log("Connected to suggested node = ", connected_node)
			}).catch((err) => {
				console.log("Error connecting to suggested node ", err);
			});
			console.log("\n\n###Attempting to fund channel with %s ...", node);
			this._lightning.fundchannel(node, sats).then((channel) => {
				console.log("Successfully funded channel with suggested node = ", channel);
			}).catch((err) => {
				console.log("Could not fund channel with suggested node = ", err);
			});		
		}
	}
}