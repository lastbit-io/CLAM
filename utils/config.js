let config = {
  bitcoind: {
    rpc: "YOUR-RPC",
  },
  DB_URL: "YOUR-DB",
  ELECTRS_BASE: "YOUR-ELECTRS-BASE",
  SERVER_VERSION: 1,
  AP_FREQ: 500000, // Autopilot frequency
  LIGHTNING_PATH: "YOUR-LIGHTNING-PATH",
  LIGHTNING_PAY_TIMEOUT: 15000,
  APP_PORT: 50000,
  INTERNAL_INVOICE_FEES: 0,
  JWT: {
    JWT_SECRET: "STRONG-SECRET", //WARNING: DEPRECATED, USE JWT_SECRET!
    JWT_EXPIRY: 7200, // 120 minutes/7200 seconds
    JWT_ISSUER: "YOUR-ISSUER",
    JWT_AUDIENCE: "YOUR-AUDIENCE",
  },
};

module.exports = config;
