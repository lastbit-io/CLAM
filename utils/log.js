var winston = require("winston");
const env = process.env.NODE_ENV;
const logDir = "logs";
const fs = require("fs");

if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

const now = new Date();
var logger = winston.createLogger({
  transports: [
    new winston.transports.File({
      name: "error-file",
      filename: "./logs/clam.log",
      level: "info",
      json: false,
    }),

    new (require("winston-daily-rotate-file"))({
      filename: `${logDir}/__api.log`,
      timestamp: now,
      datePattern: "YYYY-MM-DD-HH",
      prepend: true,
      json: false,
      level: env === "development" ? "verbose" : "info",
    }),
  ],
  exitOnError: false,
});

module.exports = logger;
module.exports.stream = {
  write: function (message, encoding) {
    logger.info(message);
    console.log("\n%%% Logger message =", message);
  },
};
