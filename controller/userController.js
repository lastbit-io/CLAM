let logger = require("../utils/log");
const HelperFunc = require("./container/helper").Helper;
const helperFunc = new HelperFunc();
const User = require("../models/user");
const responseHelper = require("../utils/helpers").helpers();
const passport = require("passport");
const jwt = require("jsonwebtoken");
const {
  JWT_EXPIRY,
  JWT_ISSUER,
  JWT_AUDIENCE,
} = require("../utils/config").JWT;
const Token = require("../models/token");

async function createToken(user, body) {
  var token = jwt.sign({ user: body }, user.password, {
    expiresIn: JWT_EXPIRY,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
  await Token.create({
    jwt: token,
    created: new Date(),
    owner: user._id,
    expiresIn: JWT_EXPIRY,
    expired: false,
    blacklisted: false,
  });
  return token;
}

const login = async (req, res, next) => {
  passport.authenticate("login", async (err, user, info) => {
    try {
      if (err || !user) {
        const error = new Error("Invalid user");
        res
          .status(400)
          .send(new responseHelper.responseWrapper(-1, "Invalid user", {}));
        return next(error);
      }
      req.login(user, { session: false }, async (error) => {
        if (error) return next(error);
        const body = { _id: user._id, username: user.username };
        var token;
        //User can have only one active token
        var db_token = await Token.findOne({ owner: user._id, expired: false });
        if (db_token) {
          var expired_db_token = await db_token.isExpired();
          if (!expired_db_token) {
            token = db_token.jwt;
          } else {
            await Token.updateOne(
              { jwt: db_token.jwt },
              { $set: { expired: true } }
            );
            token = await createToken(user, body);
          }
        } else {
          token = await createToken(user, body);
        }
        //Send back the token to the user
        return res.json({ token });
      });
    } catch (error) {
      res
        .status(500)
        .send(new responseHelper.responseWrapper(-1, "Bad user", {}));
      return next(error);
    }
  })(req, res, next);
};

const signup = async (req, res, next) => {
  passport.authenticate(
    "signup",
    { session: false },
    async (err, user, info) => {
      try {
        if (err || !user) {
          const error = new Error("Invalid");
          res
            .status(400)
            .send(new responseHelper.responseWrapper(-1, "Invalid user", {}));
          return next(error);
        }
        req.login(user, { session: false }, async (error) => {
          if (error) return next(error);
          return res.json({
            message: "Signup successful",
          });
        });
      } catch (error) {
        res
          .status(500)
          .send(new responseHelper.responseWrapper(-1, "Invalid user", {}));
        return next(error);
      }
    }
  )(req, res, next);
};

const getHid = async (req, res) => {
  try {
    const u = await User.findOne({ _id: req.user._id }).catch((error) => {
      responseHelper.mongoError(res);
      throw new Error("Mongodb cannot fetch user " + req.user._id);
    });
    let new_hid = 0;
    if (!u.hid) new_hid = await helperFunc.createhid(u.id);
    res.status(200).send(
      new responseHelper.responseWrapper(1, "Got hid", {
        hid: new_hid == 0 ? u.hid : new_hid,
      })
    );
  } catch (error) {
    logger.error("/getHid " + JSON.stringify(error));
    return responseHelper.genericError(res, error);
  }
};

const setHid = async (req, res) => {
  try {
    const u = await User.findOne({ _id: req.user._id }).catch((error) => {
      logger.error("/sethid mongo error" + JSON.stringify(error));
      responseHelper.mongoError(res);
      throw new Error("Mongodb cannot fetch user " + req.user._id);
    });
    if (!req.body.hid) return responseHelper.errorBadArguments(res);
    let result = await helperFunc.sethid(u._id, req.body.hid);
    if (result == 1) {
      res
        .status(200)
        .send(new responseHelper.responseWrapper(1, "Set hid", {}));
      return;
    } else if (result == 0) return responseHelper.duplicateHid(res);
    else return responseHelper.errorGeneralServerError(res);
  } catch (error) {
    logger.error("/setHid " + JSON.stringify(error));
    return responseHelper.genericError(res, error);
  }
};

const getDepositAddress = async (req, res) => {
  try {
    logger.info("/getdepositaddress" + JSON.stringify(req.user));
    const u = await User.findOne({ _id: req.user._id }).catch((error) => {
      responseHelper.mongoError(res);
      throw new Error(
        "Mongodb cannot fetch user " + req.user._id + " error = " + error
      );
    });

    let address = u.depositAddress;
    if (!address) {
      let result = await helperFunc.generateAddress(u._id).catch((err) => {
        logger.error("/getdepositaddress cln error " + JSON.stringify(err));
        return responseHelper.errorCln(res);
      });

      return res.status(200).send(
        new responseHelper.responseWrapper(1, "Got deposit address", {
          address: result.address,
        })
      );
    } else {
      res.status(200).send(
        new responseHelper.responseWrapper(1, "Got deposit address", {
          address: address,
        })
      );
    }
  } catch (error) {
    logger.error("/getDepositAddress " + JSON.stringify(error));
    return responseHelper.genericError(res, error);
  }
};

const getTxs = async (req, res) => {
  try {
    logger.info("/gettxs " + JSON.stringify(req.user));
    const u = await User.findOne({ _id: req.user._id }).catch((error) => {
      logger.error("/gettxs mongo error" + JSON.stringify(error));
      responseHelper.mongoError(res);
      throw new Error("Mongodb cannot fetch user " + req.user._id);
    });

    // Check if user has a deposit address assigned, if not assign a new one
    let user_deposit_address = u.depositAddress;
    if (!u.depositAddress) {
      let response = await helperFunc.generateAddress(u._id).catch((err) => {
        logger.error("/gettxs cln error " + JSON.stringify(err));
        responseHelper.errorCln(res);
        return;
      });
      user_deposit_address = response.address;
    }
    // With new address assigned, check for all possible transactions and return
    try {
      let user_txs = await helperFunc.getTransactions(u._id);
      let balance = await helperFunc.getCalculatedBalance(u._id);
      res.status(200).send(
        new responseHelper.responseWrapper(1, "Got user transactions", {
          txs: user_txs,
          balance: balance,
        })
      );
    } catch (error) {
      logger.error("/gettxs " + JSON.stringify(error));
      console.log("\n\n### gettxs ERROR = ", error);
      responseHelper.genericError(res, error);
      return;
    }
  } catch (error) {
    logger.error("/gettxs " + JSON.stringify(error));
    return responseHelper.genericError(res, error);
  }
};

const getPending = async (req, res) => {
  try {
    logger.info("/getpending" + JSON.stringify(req.user));
    const u = await User.findOne({ _id: req.user._id }).catch((error) => {
      logger.error("/gettxs mongo error " + JSON.stringify(error));
      responseHelper.genericError(res, error);
      throw new Error("Mongodb cannot fetch user " + req.user._id);
    });

    if (!u.depositAddress) {
      await helperFunc.generateAddress(u._id).catch((err) => {
        logger.error("/getpending cln error " + JSON.stringify(err));
        responseHelper.genericError(res, err);
        return;
      });
    }
    let txs = await helperFunc.getPendingTxs(u._id);
    res.status(200).send(
      new responseHelper.responseWrapper(1, "Got pending transactions", {
        txs: txs,
      })
    );
  } catch (error) {
	  console.log("Error : ",error)
    logger.error("/getPending " + JSON.stringify(error));
    return responseHelper.genericError(res, error);
  }
};

const getBalance = async (req, res) => {
  try {
    logger.info("/getbalance" + JSON.stringify(req.user));
    const u = await User.findOne({ _id: req.user._id });
    let balance = await helperFunc.getCalculatedBalance(u._id);
    return res.status(200).send(
      new responseHelper.responseWrapper(1, "Got balance", {
        balance: balance,
      })
    );
  } catch (error) {
    logger.error("/getPending ",(error));
    return responseHelper.genericError(res, error);
  }
};
module.exports = {
  getHid,
  setHid,
  getDepositAddress,
  getTxs,
  getPending,
  getBalance,
  login,
  signup,
};
