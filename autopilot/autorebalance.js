const lightning_client = require('../lightning-client-js');
var lightning = new lightning_client("/root/.lightning", true);

var incoming_scid = null;

let findDeep = function (data) {
    return data.find(function (e) {
        if (e.short_channel_id == incoming_scid) return e;
        else if (e.channels) return findDeep(e.channels);
    });
}

async function getIncomingChannelDetails() {
    let peers = await lightning.listpeers();
    let incomingChannelDetails = findDeep(peers.peers);
    return incomingChannelDetails;
}

async function selectOutgoingChannels() {
    let peers = await lightning.listpeers();
    peers = peers.peers;
    let ourChannels = [], selectedOutgoingChannels = [];
    peers.find(function (e) {
        if (e.state == 'CHANNELD_NORMAL' && e.short_channel_id != incoming_scid) ourChannels.push(e);
        else if (e.connected && e.channels.length > 0) ourChannels.push(e.channels[0]);
    });
    for (let chan of ourChannels) {
        chan.ours = chan.msatoshi_to_us;
        chan.theirs = chan.msatoshi_total - chan.msatoshi_to_us;
        chan.receivable = chan.theirs - (chan.their_channel_reserve_satoshis * 1000);
        chan.spendable = chan.ours - (chan.our_channel_reserve_satoshis * 1000);

        // Rebalance channels where incoming capacity is less than 25% of channel capacity
        if (chan.spendable / 4 > chan.receivable) {
            selectedOutgoingChannels.push(chan);
        }
    }
    // Sort channels ascending
    selectedOutgoingChannels.sort((a, b) => a.spendable - b.spendable);
    console.log("\nSelected " + selectedOutgoingChannels.length + " channels to rebalance");
    return selectedOutgoingChannels;
}

async function rebalance() {
    // Find outgoing channels that have <25% incoming capacity
    let selectedOutgoingChannels = await selectOutgoingChannels();
    // console.log(selectedOutgoingChannels)

    if (selectedOutgoingChannels.length < 1) {
        console.log("No Channels require rebalancing!");
        process.exit();
    }

    // Rebalance each channel in ascending order of capacity
    for (let out_chan of selectedOutgoingChannels) {
        let incomingChannelDetails = await getIncomingChannelDetails();
        // console.log(incomingChannelDetails);
        let in_chan = incomingChannelDetails.channels[0];
        if (!incomingChannelDetails.connected && in_chan.state != 'CHANNELD_NORMAL') {
            console.log("Err: Incoming channel is not CHANNELD_NORMAL!");
            process.exit();
        }

        in_chan.ours = in_chan.msatoshi_to_us;
        in_chan.theirs = in_chan.msatoshi_total - in_chan.ours;
        in_chan.receivable = in_chan.theirs - (in_chan.their_channel_reserve_satoshis * 1000);
        in_chan.spendable = in_chan.ours - (in_chan.our_channel_reserve_satoshis * 1000);

        console.log('\n\nProvided Incoming channel details:\n', {
            'Our_contribution': in_chan.ours + 'msat',
            'Their_contribution': in_chan.theirs + 'msat',
            'Receivable': in_chan.receivable + 'msat',
            'Spendable': in_chan.spendable + 'msat',
            'Our_reserve': in_chan.our_channel_reserve_satoshis * 1000 + 'msat',
            'Their_Reserve': in_chan.their_channel_reserve_satoshis * 1000 + 'msat'
        }, "\n\n");

        // As long as there is sufficient incoming capacity in the provided channel
        if (out_chan.spendable < in_chan.receivable) {
            // Rebalance half the channel capacity to incoming (default if don't provide msatoshi arg to rebalance)
            console.log("Attempting: rebalance " + out_chan.short_channel_id + " " + incoming_scid + " \n");
            // Try for 60 secondby default (rebalance) Optional TODO Promise.race
            try {
                //TODO: Handle Rebalances over 4294967000 msat in steps
                let response = await lightning.rebalance(out_chan.short_channel_id, incoming_scid);
                console.log(response, "\n\n");
            } catch (error) {
                console.log("Error while trying to Rebalance: ", error, "\n\n");
            }
        }
        else {
            console.log("Incoming channel capacity exhausted. Try again with another channel\n\n");
            lightning.summary();
            process.exit();
        }
    }
}

async function main() {
    // Get incoming_scid from command line args
    process.argv.forEach(function (val, index, array) {
        if (index == 2)
            incoming_scid = val;
    });
    if (!incoming_scid) {
        console.log("Err: Required argument incoming short channel id!");
        process.exit();
    }

    rebalance();
}

main();
