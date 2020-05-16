var logger = require("./utils/log");
var util = require("util");
const fetch = require("node-fetch");

exports.logIncomingReq = (req, res, next) => {
  logger.info(
    "Incoming Request" +
      JSON.stringify({
        time: Date.now(),
        parameters: {
          request: {
            body: req.body,
            ip: req.ip,
            method: req.method,
            path: req.originalUrl,
            protocol: req.protocol,
            authorization: req.headers["authorization"],
            userAgent: req.get("User-Agent"),
          },
        },
      })
  );
  console.log(
    "------------------------------------------------------------------------------------------------------------------------"
  );
  console.log(
    new Date() + " - Incoming request logged. Path: " + req.originalUrl
  );
  console.log(
    "Request body : " +
      util.inspect(req.body, false, null, true /* enable colors */)
  );
  console.log(
    "------------------------------------------------------------------------------------------------------------------------"
  );
  next();
};

exports.prepareNetworks = (lightning, electrs_base_url) => {
  return new Promise(async (resolve, reject) => {
    try {
      let start = await fetch(electrs_base_url + "blocks");
      let blockinfo = await start.json();
      if (blockinfo.length > 0) {
        console.log("Connected to electrs... - Last 2 blocks...");
        console.log(blockinfo[0], blockinfo[1]);
        if (blockinfo[0].height < 550000) {
          console.error("!#! Electrs is not caught up...exiting...");
          process.exit(1);
        }
      } else {
        console.log("Electrs connection error...", blockinfo);
        process.exit(2);
      }
    } catch (err) {
      console.error("!#! c-lightning failure", err);
      logger.error("c-lightning error" + JSON.stringify(err));
      process.exit(3);
    }

    var info = await lightning.getinfo().catch((error) => {
      console.error("!#! c-lightning failure", err);
      logger.error("c-lightning error" + JSON.stringify(err));
      process.exit(3);
    });
    console.info("\n### Lightning connected...\n\n", info);
    logger.info("Lightning info" + JSON.stringify(info));
  });
};
