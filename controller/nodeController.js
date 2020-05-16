var home = require("../app");
let logger = require("../utils/log");
const HelperFunc = require("./container/helper").Helper;
const helperFunc = new HelperFunc();
const config = require("../utils/config");
const uuidv4 = require("uuid/v4");
const responseHelper = require("../utils/helpers").helpers();
let lightning_client = require("../lightning-client-js");
let lightning = new lightning_client(config.LIGHTNING_PATH, true);
const CLOSE_CHANNEL_TOLERANCE = 10000;

const User = require("../models/user");

const withdraw_status_codes = {
  SUCCESS: 1,
  FAILED: 2,
  PENDING: 3,
  FAILED_CLOSE_CHANNELS: 4,
};

const getInfo = async (req, res) => {
  try {
    logger.info("/getinfo" + JSON.stringify(req.user));
    let info = await helperFunc.getInfo();
    delete info.msatoshi_fees_collected;
    delete info.fees_collected_msat;
    delete info.binding;
    delete info.version;
    delete info.color;
    let peerlist = await lightning.listpeers();
    let channel_sats = [];
    let avail_out = 0;
    let avail_in = 0;

    if (peerlist.peers.length > 0) {
      for (let peer of peerlist.peers) {
        if (peer.connected != true) continue;
        for (let channel of peer.channels) {
          if (channel.state != "CHANNELD_NORMAL") continue;
          let to_us = 0;
          //TODO: Ensure < Number.MAX_SAFE_INTEGER or use bignum
          if (parseInt(channel.our_reserve_msat) < parseInt(channel.to_us_msat))
            to_us =
              parseInt(channel.to_us_msat) - parseInt(channel.our_reserve_msat);
          avail_out += to_us;
          let to_them =
            parseInt(channel.total_msat) - parseInt(channel.to_us_msat);
          if (parseInt(channel.their_reserve_msat) < parseInt(to_them))
            to_them = to_them - parseInt(channel.their_reserve_msat);
          else to_them = 0;
          avail_in += to_them;
          channel_sats.push({
            total_msat: channel.total_msat,
            to_us: to_us,
            to_them: to_them,
            peer_id: peer.id,
            channel_id: channel.short_channel_id,
          });
        }
      }
      //TODO: Pick channel with max capacity, not total incoming/outgoing, i.e. max and min of channel_sats array
      channel_sats.sort(function (a, b) {
        return b.to_them - a.to_them;
      });
      info.max_incoming = Math.floor(channel_sats[0].to_them / 1000);
      info.safe_receive = Math.floor(
        channel_sats[0].to_them / 1000 / +peerlist.peers.length
      );
      channel_sats.sort(function (a, b) {
        return b.to_us - a.to_us;
      });
      info.max_outgoing = Math.floor(channel_sats[0].to_us / 1000);
      info.safe_send = Math.floor(
        channel_sats[0].to_us / 1000 / +peerlist.peers.length
      );
    } else {
      info.max_incoming = 0;
      info.max_outgoing = 0;
      info.safe_send = 0;
      info.safe_receive = 0;
    }
    res
      .status(200)
      .send(new responseHelper.responseWrapper(1, "Got info", { data: info }));
  } catch (error) {
    logger.error("/getInfo " + JSON.stringify(error));
    return responseHelper.genericError(res, error);
  }
};

const payInvoiceLess = async (req, res) => {
  try {
    logger.info(
      "/payinvoiceless" + JSON.stringify(req.body) + JSON.stringify(req.user)
    );
    const u = await User.findOne({ _id: req.user._id }).catch((error) => {
      logger.error("/payinvoiceless mongo error " + JSON.stringify(error));
      return responseHelper.genericError(res, error);
    });
    if (!req.body.satoshis || !req.body.recipient)
      return responseHelper.errorBadArguments(res);
    let u_recipient_id = req.body.recipient.trim();
    // Recipient ID is HID here
    const u_recipient = await User.findOne({ hid: u_recipient_id }).catch(
      (error) => {
        logger.error(
          "/payinvoiceless recipient mongo error " + JSON.stringify(error)
        );
        return responseHelper.badRecipient(res);
      }
    );
    if (!u_recipient) return responseHelper.invalidRecipient(res);
    if (u._id.equals(u_recipient._id)) return responseHelper.selfPayment(res);
    let satoshis = parseInt(req.body.satoshis);
    if (satoshis <= 0 || isNaN(satoshis))
      return responseHelper.errorBadArguments(res);
    let userBalance = await helperFunc.getCalculatedBalance(u._id);
    let feeEstimate = +config.INTERNAL_INVOICE_FEES;
    if (userBalance < satoshis + feeEstimate) {
      responseHelper.errorNotEnoughBalance(res);
      return;
    }
    /*
		Usual invoice fields to save - payment_hash, expires_at, bolt11, label, description, ispaid, amt, expire_time, timestamp, type
		*/
    let invoice = {};
    let invoiceid = uuidv4();

    invoice.id = invoiceid;
    invoice.payment_hash = uuidv4();
    invoice.label = "internal_" + invoiceid;
    invoice.internalidpayment = 1;
    invoice.memo = u.hid + "_to_" + u_recipient.hid + "_" + satoshis + "_sats";
    invoice.timestamp = new Date();
    invoice.created_at = Math.round(new Date().getTime() / 1000);
    invoice.destination = u_recipient.hid;
    invoice.fee = +config.INTERNAL_INVOICE_FEES; // Fee in sats
    invoice.total_fees = feeEstimate;
    invoice.value = satoshis - invoice.total_fees;
    invoice.type = "paid_invoice";
    invoice.msatoshi_sent = satoshis * 1000;
    invoice.status = "complete";
    await helperFunc.saveHidPaidInvoice(u._id, invoice);
    invoice.ispaid = true;
    invoice.type = "user_hid_invoice";
    await helperFunc.saveHidUserInvoice(u_recipient._id, invoice);
    await helperFunc.getCalculatedBalance(u._id); //Recalculate user balance
    helperFunc.getCalculatedBalance(u_recipient._id); //Update recipient balance async
    //Remove sensitive parameters useless to app here -
    delete invoice.payment_hash;
    delete invoice.id;
    return res.status(200).send(
      new responseHelper.responseWrapper(1, "Paid invoice", {
        payment: invoice,
      })
    );
  } catch (error) {
    logger.error("/getInfo " + JSON.stringify(error));
    return responseHelper.genericError(res, error);
  }
};

const getUserInvoices = async (req, res) => {
  try {
    logger.info("/getuserinvoices" + JSON.stringify(req.user));
    const u = await User.findOne({ _id: req.user._id }).catch((error) => {
      logger.error("/getuserinvoices mongo error " + JSON.stringify(error));
      return responseHelper.genericError(res, error);
    });
    let invoices = await helperFunc.getUserInvoices(u._id);
    if (req.body.limit && !isNaN(parseInt(req.body.limit))) {
      res.status(200).send(
        new responseHelper.responseWrapper(1, "Got invoices with limit", {
          invoices: invoices.slice(parseInt(req.body.limit) * -1),
        })
      );
      return;
    } else {
      res.status(200).send(
        new responseHelper.responseWrapper(1, "Got invoices", {
          invoices: invoices,
        })
      );
      return;
    }
  } catch (error) {
    logger.error("/getUserInvoice " + JSON.stringify(error));
    return responseHelper.genericError(res, error);
  }
};

const payInvoice = async (req, res) => {
  try {
    const u = await User.findOne({ _id: req.user._id }).catch((error) => {
      logger.error("/payinvoice mongo error " + JSON.stringify(error));
      return responseHelper.genericError(res, error);
    });
    if (!req.body.invoice) return responseHelper.errorBadArguments(res);
    let bolt11 = req.body.invoice.trim();
    let userBalance = await helperFunc.getCalculatedBalance(u._id);
    if (!!(await helperFunc.getLockedFundsStatus(u._id, bolt11))) {
      return responseHelper.paymentInProgress(res);
    }
    let info = await lightning.decodepay(bolt11).catch(async function (err) {
      if (err) {
        console.log("### /payinvoice Invalid invoice : ", err);
        return responseHelper.errorNotAValidInvoice(res);
      }
    });
    let satoshisToPay = +info.msatoshi / 1000;
    let feeEstimate = +config.INTERNAL_INVOICE_FEES;
    let maxSatoshisToPay = satoshisToPay + feeEstimate;
    if (userBalance >= maxSatoshisToPay) {
      console.log("\n\n### Checking if invoice is already paid...");
      if (!!(await helperFunc.getPaymentHashPaid(u._id, info.payment_hash))) {
        responseHelper.alreadyPaid(res);
        return;
      }
      let internal_payment = await helperFunc.getInternalPaymentHash(
        info.payment_hash,
        u._id
      );
      if (internal_payment == 1) {
        responseHelper.alreadyPaid(res);
        return;
      } else if (internal_payment == 2) {
        responseHelper.selfPayment(res);
        return;
      } else if (internal_payment == 0) {
        var save_payment = JSON.parse(JSON.stringify(info));
        save_payment.type = "paid_invoice";
        save_payment.internal = 1;
        save_payment.msatoshi_sent = info.msatoshi;
        save_payment.fee = +config.INTERNAL_INVOICE_FEES; // Fee in sats
        save_payment.total_fees = +feeEstimate;
        save_payment.created_at = Math.round(new Date().getTime() / 1000);
        save_payment.value = info.msatoshi / 1000 - save_payment.total_fees; // Value in sats
        save_payment.memo = decodeURIComponent(info.description);
        save_payment.status = "complete";
        save_payment.destination = info.payee;
        await helperFunc.savePaidInvoice(u._id, save_payment);
        let new_balance = await helperFunc.getCalculatedBalance(u._id); //Recalculate user balance
        delete save_payment.routes;
        delete save_payment.min_final_cltv_expiry;
        delete save_payment.payment_hash;
        delete save_payment.signature;
        return res.status(200).send(
          new responseHelper.responseWrapper(1, "Paid internal invoice", {
            payment: save_payment,
          })
        );
      }
      feeEstimate = Math.floor(satoshisToPay * 0.01);
      maxSatoshisToPay = satoshisToPay + feeEstimate;
      if (userBalance >= maxSatoshisToPay) {
        await helperFunc.lockFunds(u._id, bolt11, satoshisToPay);
        let payment_attempt = helperFunc.promiseTimeout(
          config.LIGHTNING_PAY_TIMEOUT,
          helperFunc.payInvoice(u._id, bolt11, info)
        );
        await payment_attempt
          .then(async (payment) => {
            delete payment.payment_hash;
            delete payment.id;
            delete payment.payment_preimage;
            res.status(200).send(
              new responseHelper.responseWrapper(1, "Paid invoice", {
                payment: payment,
              })
            );
            await helperFunc.getCalculatedBalance(u._id); //Recalculate user balance
            return;
          })
          .catch((error) => {
            console.log("\n\nPay invoice Promise returned failure =", error);
            responseHelper.errorPaymentFailed(res, error);
            return;
          });
      } else {
        responseHelper.errorNotEnoughBalance(res);
        return;
      }
    } else {
      responseHelper.errorNotEnoughBalance(res);
      return;
    }
  } catch (error) {
    logger.error("/payInvoice " + JSON.stringify(error));
    return responseHelper.genericError(res, error);
  }
};

const getNearByInvoices = async (req, res) => {
  try {
    if (
      !req.body.latitude ||
      !req.body.longitude ||
      !req.body.radius ||
      req.body.radius < 0
    )
      return responseHelper.errorBadArguments(res); //radius in metres
    if (
      isNaN(req.body.latitude) ||
      isNaN(req.body.longitude) ||
      isNaN(req.body.radius)
    )
      return responseHelper.errorBadArguments(res);
    var invoices = await helperFunc.getNearbyInvoices(
      req.user._id,
      req.body.latitude,
      req.body.longitude,
      req.body.radius
    );
    return res.status(200).send(
      new responseHelper.responseWrapper(1, "Nearby invoices", {
        invoices: invoices,
      })
    );
  } catch (error) {
    console.log("### Error getting nearby invoices : ", error);
    responseHelper.errorGeneralServerError(res);
  }
};

const checkRoute = async () => {
  try {
    logger.info("/checkroute" + JSON.stringify(req.user));
    if (!req.body.invoice) {
      responseHelper.errorBadArguments(res);
      return;
    }
    var bolt11 = req.body.invoice;
    let riskFactor = 10; // Default pay riskfactor, see `cli/lightning-cli help getroute`
    let invoice = await lightning.decodepay(bolt11);
    let result = await lightning
      .getroute(invoice.payee, invoice.msatoshi, riskFactor)
      .catch((err) => {
        responseHelper.genericError(res, err);
        return;
      });
    res.status(200).send(
      new responseHelper.responseWrapper(1, "Got route", {
        route: result.route,
      })
    );
    return;
  } catch (error) {
    responseHelper.errorNotAValidInvoice(res);
    return;
  }
};

const addInvoice = async (req, res) => {
  try {
    const u = await User.findOne({ _id: req.user._id }).catch((error) => {
      logger.error("/addinvoice mongo error " + JSON.stringify(error));
      responseHelper.genericError(res, error);
      throw new Error("Mongodb cannot fetch user " + req.user._id);
    });
    if (
      !req.body.satoshis ||
      !req.body.label ||
      !req.body.latitude ||
      !req.body.longitude
    )
      return responseHelper.errorBadArguments(res);
    var satoshis = req.body.satoshis;
    var label = req.body.label;
    var description = req.body.description || "";
    var expires_at = req.body.expiry == undefined ? 3600 : req.body.expiry;
    var latitude = +req.body.latitude;
    var longitude = +req.body.longitude;
    let invoice = await helperFunc
      .addInvoice(satoshis, label, description, expires_at)
      .catch((error) => {
        console.log("\nCLN added invoice, server error = ", error);
        if (error.error != undefined)
          //code=900 for duplicate invoice
          responseHelper.duplicateInvoice(res);
        else responseHelper.errorGeneralServerError(res);
        return;
      });

    // C-Lightning References invoices with labels (RPC `listinvoices label`)
    invoice.label = label;
    invoice.location = {
      type: "Point",
      coordinates: [longitude, latitude],
    };
    //TODO: Assign new unique HID until user can set
    invoice.hid = u.hid == undefined ? "legacy" : u.hid;
    invoice.sats = satoshis;
    await helperFunc.saveUserInvoice(u._id, invoice);
    delete invoice.payment_hash;
    res.status(200).send(
      new responseHelper.responseWrapper(1, "Saved invoice", {
        invoice: invoice,
      })
    );
    return;
  } catch (error) {
    console.log("/addInvoice ", error);
    return responseHelper.genericError(res, error);
  }
};

const withdraw = async (req, res) => {
  logger.info("/withdraw" + JSON.stringify(req.user));
  const u = await User.findOne({ _id: req.user._id }).catch((error) => {
    logger.error("/withdraw mongo error " + JSON.stringify(error));
    responseHelper.genericError(res, error);
    throw new Error("Mongodb cannot fetch user " + req.user._id);
  });
  const withdrawal_id = uuidv4();
  var { address, satoshis } = req.body;
  //TODO: See if address exists in db. If so, throw error
  let not_unique_address = await User.findOne({ depositAddress: address });
  if (not_unique_address) {
    responseHelper.errorInternalWithdrawal(res);
    return;
  }
  let maxWithdrawableAmt = await helperFunc.getCalculatedBalance(u._id);
  if (satoshis > maxWithdrawableAmt) {
    responseHelper.errorNotEnoughBalance(res);
    return;
  }
  // CRITICAL Get cli_node_balance for outputs of only CONFIRMED transactions, not unconfirmed
  let nodeBalance = await helperFunc.cli_node_balance(false);
  let confirmedNodeBalance = await helperFunc.cli_node_balance(true);
  if (confirmedNodeBalance.outputs + confirmedNodeBalance.channels < satoshis) {
    responseHelper.errorNotEnoughBalance(res);
    return;
  }
  await helperFunc.lockFunds(u._id, withdrawal_id, satoshis).then((res) => {
    console.log("\n### Locked funds for user withdrawal!");
  });

  if (confirmedNodeBalance.outputs >= satoshis) {
    // Withdraw from node internal funds
    lightning
      .withdraw(address, satoshis)
      .then(async (result) => {
        if (result.txid) {
          await helperFunc.saveWithdrawal(
            withdrawal_id,
            u._id,
            result.txid,
            address,
            satoshis,
            withdraw_status_codes.SUCCESS
          );
          await helperFunc.unlockFunds(u._id, withdrawal_id);
          await helperFunc
            .lockFunds(u._id, result.txid, satoshis)
            .then((res) => {
              logger.info(
                "### Locked funds for successfully broadcasted withdrawal! = " +
                  result.txid
              );
              console.log(
                "\n### Locked funds for successfully broadcasted withdrawal! = " +
                  result.txid
              );
            });
          res.status(200).send(
            new responseHelper.responseWrapper(1, "Successful withdrawal", {
              txid: result.txid,
            })
          );
          return;
        }
      })
      .catch(async (err) => {
        console.log("\n\n !#! lightning withdraw from internal failed = ", err);
        await helperFunc.saveWithdrawal(
          withdrawal_id,
          u._id,
          "",
          address,
          satoshis,
          withdraw_status_codes.FAILED
        );
        await helperFunc.unlockFunds(u._id, withdrawal_id);
        responseHelper.handleWithdrawFailedError(res, err);
        return;
      });
  } else {
    var amount_to_close_channels_for = satoshis - confirmedNodeBalance.outputs;
    await helperFunc.saveWithdrawal(
      withdrawal_id,
      u._id,
      "",
      address,
      satoshis,
      withdraw_status_codes.PENDING
    );
    await lightning
      .listfunds()
      .then(async (funds) => {
        let sorted_channel_sats = {};
        for (let x of funds.channels)
          sorted_channel_sats[x.peer_id] = x.channel_sat;
        var sorted_channel_sats_arr = Object.keys(sorted_channel_sats).map(
          function (key) {
            return [key, sorted_channel_sats[key]];
          }
        );
        sorted_channel_sats_arr.sort(function (first, second) {
          return second[1] - first[1];
        });
        //TODO: "Smarter" way of closing channels without closing channel of max capacity
        let candidate_peers = [];
        let k = 0;
        for (let peer of sorted_channel_sats_arr)
          if (
            peer[1] >= amount_to_close_channels_for - CLOSE_CHANNEL_TOLERANCE &&
            peer[1] <= amount_to_close_channels_for + CLOSE_CHANNEL_TOLERANCE
          )
            candidate_peers.push({ peerid: peer[0], amount: peer[1] });
        var candidate_peers_sum = candidate_peers.reduce(
          (a, b) => a + (b["amount"] || 0),
          0
        );
        if (
          candidate_peers.length == 0 ||
          candidate_peers_sum < amount_to_close_channels_for
        ) {
          console.log("No candidate peers, closing sequentially...");
          while (
            candidate_peers_sum <= amount_to_close_channels_for &&
            k < sorted_channel_sats_arr.length
          ) {
            candidate_peers.push({
              peerid: sorted_channel_sats_arr[k][0],
              amount: sorted_channel_sats_arr[k][1],
            });
            candidate_peers_sum = candidate_peers.reduce(
              (a, b) => a + (b["amount"] || 0),
              0
            );
            k++;
          }
        }
        candidate_peers_sum = candidate_peers.reduce(
          (a, b) => a + (b["amount"] || 0),
          0
        );
        if (candidate_peers_sum < amount_to_close_channels_for) {
          console.error(
            "### CRITICAL - node balance + channel balance < user withdrawal request!"
          );
          await helperFunc.unlockFunds(u._id, withdrawal_id);
          await helperFunc.saveWithdrawal(
            withdrawal_id,
            u._id,
            "",
            address,
            satoshis,
            withdraw_status_codes.FAILED
          );
          responseHelper.handleWithdrawFailedError(res, "Not enough balance"); //Should never execute
          return;
        }
        await lightning
          .listpeers()
          .then(function (list_peers) {
            for (var peer of list_peers.peers) {
              for (let candidate_peer of candidate_peers) {
                if (candidate_peer.peerid == peer.id) {
                  //TODO: Handle case when channels aren't closed for whatever reason
                  lightning
                    .close(peer.channels[0].channel_id)
                    .then((closed_channel) => {
                      console.log(
                        "### Successfully closed channel with peer ",
                        peer.id
                      );
                      console.log(closed_channel);
                    })
                    .catch((err) => {
                      console.log(
                        "!#! Could not close channel with peer ",
                        peer.id
                      );
                      console.log(err);
                    });
                }
              }
            }
            var balance_interval = setInterval(async function () {
              let node_balance = await helperFunc.cli_node_balance(true);
              if (node_balance.outputs >= satoshis) {
                lightning
                  .withdraw(address, satoshis)
                  .then(async (result) => {
                    if (result.txid) {
                      console.log(u._id, "Withdrew " + satoshis + " sats");
                      await helperFunc.saveWithdrawal(
                        withdrawal_id,
                        u._id,
                        result.txid,
                        address,
                        satoshis,
                        withdraw_status_codes.SUCCESS
                      );
                      await helperFunc.unlockFunds(u._id, withdrawal_id);
                      await helperFunc
                        .lockFunds(u._id, result.txid, satoshis)
                        .then((res) => {
                          logger.info(
                            "### Locked funds for successfully broadcasted withdrawal! = " +
                              result.txid
                          );
                          console.log(
                            "\n### Locked funds for successfully broadcasted withdrawal! = " +
                              result.txid
                          );
                        });
                      clearInterval(balance_interval);
                    }
                  })
                  .catch(async (error) => {
                    await helperFunc.saveWithdrawal(
                      withdrawal_id,
                      u._id,
                      "",
                      address,
                      satoshis,
                      withdraw_status_codes.FAILED_CLOSED_CHANNELS
                    );
                    await helperFunc.unlockFunds(u._id, withdrawal_id);
                    throw new Error(
                      "Could not process lightning withdrawal, error = " + error
                    );
                  });
              }
            }, 5000);
          })
          .catch(async (error) => {
            await helperFunc.saveWithdrawal(
              withdrawal_id,
              u._id,
              "",
              address,
              satoshis,
              withdraw_status_codes.FAILED_CLOSED_CHANNELS
            );
            await helperFunc.unlockFunds(u._id, withdrawal_id);
            responseHelper.handleWithdrawFailedError(res, error);
            return;
          });
      })
      .catch(async (error) => {
        await helperFunc.saveWithdrawal(
          withdrawal_id,
          u._id,
          "",
          address,
          satoshis,
          withdraw_status_codes.FAILED_CLOSED_CHANNELS
        );
        await helperFunc.unlockFunds(u._id, withdrawal_id);
        responseHelper.handleWithdrawFailedError(res, error);
        return;
      });
    res
      .status(200)
      .send(
        new responseHelper.responseWrapper(
          1,
          "Closing channels and processing withdrawal.",
          {}
        )
      );
  }
};

const decodePay = async (req, res) => {
  try {
    if (!req.body.invoice) {
      responseHelper.errorBadArguments(res);
      return;
    }
    var bolt11 = req.body.invoice.trim();
    let invoice = await lightning.decodepay(bolt11).catch((errorResult) => {
      if (errorResult) {
        responseHelper.errorNotAValidInvoice(res);
        return;
      }
      responseHelper.errorGeneralServerError(res);
      return;
    });

    res.status(200).send(
      new responseHelper.responseWrapper(1, "Decoded BOLT11", {
        invoice: invoice,
      })
    );
    return;
  } catch (error) {
    logger.error("/decodePay " + JSON.stringify(error));
    return responseHelper.genericError(res, error);
  }
};

module.exports = {
  getNearByInvoices,
  payInvoice,
  getUserInvoices,
  payInvoiceLess,
  getInfo,
  checkRoute,
  getNearByInvoices,
  addInvoice,
  decodePay,
  withdraw,
};
