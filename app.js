var express = require("express");
var morgan = require("morgan");
var passport = require("passport");
const bodyParser = require("body-parser");
var promise = require("bluebird");
var swaggerUi = require("swagger-ui-express"),
  swaggerDocument = require("./swagger.json");

var initialSetup = require("./initialSteup");
const config = require("./utils/config");
var logger = require("./utils/log");
const indexRouter = require("./routes/router");
let lightning_client = require("./lightning-client-js");
const mongoose = require("mongoose");

const lightning = new lightning_client(config.LIGHTNING_PATH, true);
const electrs_base_url = config.ELECTRS_BASE;

mongoose.connect(config.DB_URL, {
  useNewUrlParser: true,
  useCreateIndex: true,
});

mongoose.connection.on("error", (error) => {
  console.log("!#! Mongo connection error = ", error);
  logger.error("Mongo connection error" + JSON.stringify(error));
});
mongoose.Promise = global.Promise;

var app = express();
app.helpers = require("./utils/helpers").helpers();

logger.info("*** Start logging... ***");

require("./controller/container/auth");
app.use(passport.initialize());
app.use(passport.session());
app.use(morgan("combined", { stream: logger.stream }));
app.use(morgan('On [:date[clf]] by ":referrer" ":user-agent"'));
app.use(bodyParser.urlencoded({ extended: false })); // Parse application/x-www-form-urlencoded
app.use(bodyParser.json(null)); // Parse application/json
app.use(initialSetup.logIncomingReq);
app.use("/static", express.static("static"));
app.use("/api/", indexRouter);
app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
const init = async () => {
  await initialSetup
    .prepareNetworks(lightning, electrs_base_url)
    .catch((error) => {
      console.error(
        "Error : ",
        error
      );
    });
};
init();

process.on("uncaughtException", function (err) {
  console.error("!#! uncaughtException = ", err);
  logger.error("uncaughtException" + JSON.stringify(err));
});

process.on("unhandledRejection", function (err) {
  console.log("!#! unhandledRejection = ", err);
  logger.error("unhandledRejection" + JSON.stringify(err));
});

process.on("TypeError", function (err) {
  console.log("!#! TypeError = ", err);
  logger.error("TypeError" + JSON.stringify(err));
});

app.listen(config.APP_PORT, function () {
  logger.info("Bank starting..." + "Listening on port " + config.APP_PORT);
  console.log("Listening on port ", config.APP_PORT);
});
