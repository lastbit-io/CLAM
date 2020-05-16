const bitcoin = require('bitcoinjs-lib');
const zmq = require('zeromq');
const sock = new zmq.Subscriber;
const ZMQ_ADDRESS = "tcp://127.0.0.1:25000";
const WebSocket = require('ws')
const wss = new WebSocket.Server({ port: 9009 });

async function run() {
  sock.connect(ZMQ_ADDRESS);
  sock.subscribe('rawtx');
  console.log(`Server connected to bitcoind zmq on ${ZMQ_ADDRESS}`);
  for await (const [topic, message] of sock) {
    try {
      if(topic.toString() === 'rawtx') {
          wss.clients.forEach(function each(ws) {
            if (ws.isAlive === false) return ws.terminate();
            var tx = bitcoin.Transaction.fromHex(message);
            //https://github.com/bitcoinjs/bitcoinjs-lib/issues/1104
            ws.emit('message', tx);
        });
      }
    } catch (error) {
      console.error("Error processing zmq rawtx message ", error);
    }
  }
}


wss.on('connection', function connection(ws) {
  ws.on('message', function incoming(tx) {
    ws.send(JSON.stringify(tx));
  });
});

run();
