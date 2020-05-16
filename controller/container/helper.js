let logger = require("../../utils/log");
let config = require("../../utils/config");
const uuidv4 = require("uuid/v4");
var shortid = require("shortid");
let lightning_client = require("../../lightning-client-js");
var lightningPayReq = require("bolt11");
let lightning = new lightning_client(config.LIGHTNING_PATH, true);
const fetch = require("node-fetch");
var home = require("../../app");
const User = require("../../models/user");
const Invoices = require("../../models/invoices");
const SATS = 100000000;
const BigNumber = require("bignumber.js").BigNumber;

class Helper {
  constructor() {
    this.electrs_base_url = config.ELECTRS_BASE;
  }

  printArgs = (func, query, array) => {
    console.log("\n function : ", func);
    console.log("\n query : ", query);
    array.forEach((argument, index) => {
      console.log("\n arugment " + index + " : ", argument);
    });
  };

  getInfo = async () => {
    try {
      var info = await lightning.getinfo();
      return info;
    } catch (error) {
      throw error;
    }
  };

  listPeers = async () => {
    try {
      var peers = await lightning.listpeers();
      return peers;
    } catch (error) {
      throw error;
    }
  };

  addInvoice = (satoshis, label, description, expiry) => {
    return new Promise((resolve, reject) => {
      lightning
        .invoice(satoshis * 1000, label, description, expiry)
        .then((invoice) => {
          console.log("invoice : ", invoice);
          resolve(invoice);
        })
        .catch((error) => {
          console.log("error : ", error);
          logger.error("/addinvoice" + JSON.stringify(error));
          reject(error);
        });
    });
  };

  createhid = async (userid) => {
    let hid = shortid.generate();
    await User.updateOne({ _id: uid }, { $set: { hid: hid } }).catch(
      (error) => {
        logger.error("/createhid" + JSON.stringify(error));
        reject(error);
      }
    );
    return hid;
  };

  sethid = async (uid, hid) => {
    try {
      let dup = await User.findOne({ hid: hid });
      if (dup) return 0;
      else await User.updateOne({ _id: uid }, { $set: { hid: hid } });
      return 1;
    } catch (error) {
      logger.error("/sethid" + JSON.stringify(error));
      throw error;
    }
  };

  saveUserInvoice = async (userid, invoice) => {
    try {
      let doc = { payment_hash: invoice.payment_hash, paid: false };
      await User.updateOne({ _id: userid }, { $push: { paymentHashes: doc } });
      await User.updateOne({ _id: userid }, { $push: { invoices: invoice } });

      await Invoices.create({
        payment_hash: invoice.payment_hash,
        bolt11: invoice.bolt11,
        mongoid: userid,
        hid: invoice.hid,
        label: invoice.label,
        amount: invoice.sats,
        location: invoice.location,
        expiresAt: new Date(invoice.expires_at * 1000).toString(), //C-Lightning returns expires_at on adding invoice
        paid: false,
      });
      return "Saved user invoice";
    } catch (error) {
      logger.error("/saveUserInvoice" + JSON.stringify(error));
      throw error;
    }
  };

  generateAddress = (userid) => {
    return new Promise(async (resolve, reject) => {
      const response = await lightning.newaddr().catch((error) => {
        return reject(error);
      });
      await User.updateOne(
        { _id: userid },
        {
          $set: {
            depositAddress: response.address,
          },
        }
      ).catch((error) => {
        logger.error(
          "generateAddress mongoupdate error " + JSON.stringify(error)
        );
        reject(
          "Mongodb cannot update user deposit address " +
            userid +
            " error = " +
            error
        );
      });
      resolve(response);
    });
  };

  deleteUserInvoice = async (userid, paymenthash) => {
    try {
      await User.updateOne(
        { _id: userid },
        { $pull: { paymentHashes: { payment_hash: paymenthash } } }
      );
      await User.updateOne(
        { _id: userid },
        { $pull: { invoices: { payment_hash: paymenthash } } }
      );
      await Invoices.deleteOne({ payment_hash: paymenthash });
      return "Deleted user invoice";
    } catch (error) {
      logger.error("/deleteUserInvoice" + JSON.stringify(error));
      throw error;
    }
  };

  promiseTimeout = (ms, promise) => {
    let timeout = new Promise((resolve, reject) => {
      let id = setTimeout(() => {
        clearTimeout(id);
        reject("Payment timed out");
      }, ms);
    });
    return Promise.race([promise, timeout]);
  };

  decodePay = (bolt11) => {
    return new Promise(async (resolve, reject) => {
      try {
        var info = await lightning.decodepay(bolt11);
        resolve(info);
      } catch (error) {
        logger.error("/decodePay" + JSON.stringify(error));
        reject(error);
      }
    });
  };

  getPaymentHashPaid = async (userid, payment_hash) => {
    try {
      const u = await User.findOne({ _id: userid });
      for (let pm of u.paymentHashes)
        if (pm.payment_hash == payment_hash && pm.paid == true) return(1);
      return 0;
    } catch (error) {
      logger.error("/getPaymentHashPaid" + JSON.stringify(error));
      throw error;
    }
  };

  lookupInvoice = (invoice_label) => {
    return new Promise((resolve, reject) => {
      lightning
        .listinvoices(invoice_label)
        .then(async function (response) {
          let invoice_by_label = response.invoices[0];
          resolve(invoice_by_label);
        })
        .catch((error) => {
          logger.error("/lookupInvoice" + JSON.stringify(error));
          reject(error);
        });
    });
  };

  deleteExpiredInvoice = async (userid, invoice) => {
    let lookup_info = await this.lookupInvoice(invoice.label);
    if (lookup_info && lookup_info.status == "expired") {
      await lightning.delinvoice(invoice.label, "expired").catch((error) => {
        logger.error("/deleteExpiredInvoice" + JSON.stringify(error));
        throw error;
      });
      await this.deleteUserInvoice(userid, invoice.payment_hash).catch(
        (error) => {
          logger.error("/deleteExpiredInvoice" + JSON.stringify(error));
          throw error;
        }
      );
      return "deleted";
    }
  };

  getUserInvoices = async (userid) => {
    try {
      const u = await User.findOne({ _id: userid });
      let result = [];
      let range = u.invoices;
      for (let invoice of range) {
        if (invoice.internalidpayment == 1) {
          if (new Date() > new Date(invoice.expiresAt)) {
            console.log("/n/n### Delete expired invoice from INVOICES...");
            await this.deleteUserInvoice(userid, invoice.payment_hash).catch(
              (error) => {
                logger.error("/getUserInvoices" + JSON.stringify(error));
                throw error;
              }
            );
            continue;
          }
          delete invoice.payment_hash;
          result.push(invoice);
          /*
			hid payments are instant. No need to check and update info here.
			*/
          continue;
        }

        /*
		If not hid payment, process as normal invoice
		*/
        let decoded = lightningPayReq.decode(invoice.bolt11);
        invoice.description = "";
        for (let tag of decoded.tags) {
          if (tag.tagName === "description") {
            invoice.description += decodeURIComponent(tag.data);
          }
          if (tag.tagName === "payment_hash") {
            invoice.payment_hash = tag.data;
          }
        }
        invoice.ispaid = !!(await this.getPaymentHashPaid(
          userid,
          invoice.payment_hash
        ));
        if (!invoice.ispaid) {
          // attempting to lookup invoice
          let lookup_info = await this.lookupInvoice(invoice.label);
          if (lookup_info) {
            if (lookup_info.status == "paid") invoice.ispaid = true;
            if (invoice.ispaid)
              await this.setPaymentHashPaid(userid, invoice.payment_hash);
            else if (!invoice.ispaid && lookup_info.status == "expired") {
              await this.deleteExpiredInvoice(u._id, invoice);
              continue;
            }
          }
        }

        invoice.value = decoded.satoshis;
        invoice.expire_time = 3600;
        invoice.created_at = decoded.timestamp;
        invoice.type = "user_invoice";
        // Find invoice in database and update it
        await User.findOneAndUpdate(
          { _id: u._id, "invoices.payment_hash": invoice.payment_hash },
          {
            $set: { "invoices.$": invoice },
          }
        );
        delete invoice.payment_hash;
        delete invoice.id;
        delete invoice.decoded;
        delete invoice.payment_preimage;
        delete invoice.routes;
        delete invoice.signature;

        result.push(invoice);
      }
      return result;
    } catch (error) {
      logger.error("/getUserInvoices" + JSON.stringify(error));
      throw error;
    }
  };

  getCalculatedBalance = async (userid) => {
    try {
      let calculatedBalance = 0;
      let u = await User.findOne({ _id: userid });
      let userinvoices = await this.getUserInvoices(u._id);
      let lockedPayments = u.lockedFunds;
      // Add balance for user if user has received LN payments
      for (let invoice of userinvoices) {
        if (invoice && invoice.ispaid) {
          calculatedBalance += +invoice.value;
        }
      }
      // Subtract balance for current ongoing locked LN payments
      for (let payment of lockedPayments) {
        calculatedBalance -= +payment.amount;
      }
      let txs = await this.getTransactions(userid);
      //Calculate on-chain balance
      for (let tx of txs) {
        if (tx.type == "bitcoind_tx") {
          if (tx.category == "receive") {
            calculatedBalance += +tx.value; // User deposited money on-chain - Add funds
          } else if (tx.category == "send") {
            calculatedBalance -= +tx.value; // User withdrew money on-chain - Subtract funds
          }
        } else if (tx.type == "paid_invoice") {
          // Subtract balance for user if user has sent LN payments
          calculatedBalance -= +tx.value;
        }
      }

      await User.updateOne(
        { _id: userid },
        { $set: { balance: calculatedBalance } }
      );
      return calculatedBalance;
    } catch (error) {
      logger.error("/getCalculatedBalance" + JSON.stringify(error));
      throw error;
    }
  };

  getPendingTxs = async (userid) => {
    try {
      let u = await User.findOne({ _id: userid });
      if (!u.depositAddress) {
        let response = await this.generateAddress(userid);
        u.depositAddress = response.address;
      }
      let txs = await this._listtransactions(u.depositAddress);
      let result = [];
      for (let tx of txs.result) {
        if (tx.confirmations == 0 || tx.status.confirmed == false) {
          tx.type = "bitcoind_tx";
          result.push(tx);
        }
      }
      return result;
    } catch (error) {
      console.log("error : ", error);
      logger.error("/getPendingTxs" + JSON.stringify(error));
      throw error;
    }
  };

  getLockedFundsStatus = async (userid, bolt11) => {
    const u = await User.findOne({ _id: userid });
    for (let doc of u.lockedFunds) if (doc.pay_req == bolt11) return 1;
    return 0;
  };

  getInternalPaymentHash = async (payment_hash, uid) => {
    try {
      const u = await User.findOne({
        "paymentHashes.payment_hash": payment_hash,
      });
      if (u) {
        for (let pm of u.paymentHashes)
          if (pm.payment_hash == payment_hash && pm.paid == true) return 1;
          else if (pm.payment_hash == payment_hash && pm.paid == false) {
            if (uid.equals(u._id))
              //If user is trying to pay self, throw
              return 2;
            else return 0;
          }
      }
      return -1;
    } catch (error) {
      logger.error("/getInternalPaymentHash" + JSON.stringify(error));
      throw error;
    }
  };

  savePaidInvoice = async (userid, invoice) => {
    try {
      let doc = {
        payment_hash: invoice.payment_hash,
        paid: true,
        pending: false,
      };
      if (invoice.internal == 1) {
        await User.findOneAndUpdate(
          { "paymentHashes.payment_hash": invoice.payment_hash },
          { $set: { "paymentHashes.$.paid": true } }
        );
        /*
		If  internal invoice payment, set invoice to paid in Invoices collection for *recipient*
		*/
        await Invoices.updateOne(
          { payment_hash: invoice.payment_hash },
          { $set: { paid: true } }
        );
      }
      /* Check if paying self - If yes, payment_hash is already present in paymentHashes from saveUserInvoice. Now set that to true.
	   If no, user paid regular external invoice - add to his paymentHashes.
	   Add to his paidInvoices collection in either case.
	*/
      let db_doc = await User.findOne({
        _id: userid,
        "paymentHashes.payment_hash": invoice.payment_hash,
      });
      if (db_doc)
        await User.findOneAndUpdate(
          { _id: userid, "paymentHashes.payment_hash": invoice.payment_hash },
          { $set: { "paymentHashes.$.paid": true } }
        );
      else
        await User.updateOne(
          { _id: userid },
          { $push: { paymentHashes: doc } }
        );

      await User.updateOne(
        { _id: userid },
        { $push: { paidInvoices: invoice } }
      );
      return "Paid invoice and saved";
    } catch (error) {
      logger.error("/savePaidInvoice" + JSON.stringify(error));
      throw error;
    }
  };

  // Debit sender for HID payments by creating 'paid_invoice'
  saveHidPaidInvoice = async (userid, invoice) => {
    try {
      let doc = {
        payment_hash: invoice.payment_hash,
        paid: true,
        pending: false,
      };
      await User.updateOne({ _id: userid }, { $push: { paymentHashes: doc } });
      await User.updateOne(
        { _id: userid },
        { $push: { paidInvoices: invoice } }
      );
      return "Debited hid sender";
    } catch (error) {
      logger.error("/saveHidPaidInvoice" + JSON.stringify(error));
      throw error;
    }
  };

  saveHidUserInvoice = async (userid, invoice) => {
    try {
      /*
	If internal lastbit ID payment add a new paid invoice record and the payment_hash to paymentHashes for *recipient*
	*/
      let doc = { payment_hash: invoice.payment_hash, paid: true };
      await User.updateOne({ _id: userid }, { $push: { paymentHashes: doc } });
      await User.updateOne({ _id: userid }, { $push: { invoices: invoice } });
      /*
	HID invoices do not need to be tracked for nearby payments.
	*/
      return "Saved hid invoice";
    } catch (error) {
      logger.error("/saveHidUserInvoice" + JSON.stringify(payInvoiceerror));
      throw error;
    }
  };

  payInvoice = (uid, bolt11, info) => {
    return new Promise(async (resolve, reject) => {
      let payment = await lightning.pay(bolt11).catch(async (payFailed) => {
        await this.unlockFunds(uid, bolt11);
        reject(payFailed);
      });
      await this.unlockFunds(uid, bolt11);
      if (payment.payment_hash && payment.status == "complete") {
        var save_payment = JSON.parse(JSON.stringify(payment));
        save_payment.decoded = info;
        save_payment.type = "paid_invoice";
        save_payment.value = payment.msatoshi / 1000; // Value in sats
        save_payment.fee = (payment.msatoshi_sent - payment.msatoshi) / 1000; // Fee in sats
        save_payment.memo = decodeURIComponent(info.description);
        await this.savePaidInvoice(uid, save_payment);
        resolve(payment);
      } else if (payment.status == "failed") {
        await this.unlockFunds(uid, bolt11);
        reject("failed");
      } else throw new Error("%%% Unknown payment state! Critical!");
    });
  };

  unlockFunds = async (userid, pay_req) => {
    try {
      return await User.updateOne(
        { _id: userid },
        { $pull: { lockedFunds: { pay_req: pay_req } } }
      );
    } catch (error) {
      logger.error("/unlockFunds" + JSON.stringify(error));
      throw error;
    }
  };

  lockFunds = async (userid, pay_req, amount) => {
    try {
      let doc = {
        pay_req: pay_req,
        amount: amount,
        timestamp: Math.floor(+new Date() / 1000),
      };
      return await User.updateOne(
        { _id: userid },
        { $push: { lockedFunds: doc } }
      );
    } catch (error) {
      logger.error("/lockFunds" + JSON.stringify(error));
      throw error;
    }
  };

  getNearbyInvoices = async (uid, lat, lon, radius) => {
    try {
      let fetched_invoices = await Invoices.aggregate([
        {
          $geoNear: {
            near: { type: "Point", coordinates: [+lon, +lat] },
            distanceField: "dist.calculated",
            maxDistance: +radius,
            query: { mongoid: { $ne: uid }, paid: false },
            spherical: true,
          },
        },
      ]);
      var num_invoices = fetched_invoices.length;
      while (num_invoices--) {
        var invoice = fetched_invoices[num_invoices];
        if (new Date() >= new Date(invoice.expiresAt)) {
          await this.deleteUserInvoice(invoice.mongoid, invoice.payment_hash);
          fetched_invoices.splice(num_invoices, 1);
          continue;
        }
        //invoice.id = uuidv4();
        delete invoice.payment_hash;
        delete invoice.mongoid;
        delete invoice._id;
      }
      return fetched_invoices;
    } catch (error) {
      logger.error("/getNearbyInvoices" + JSON.stringify(error));
      throw error;
    }
  };

  saveWithdrawal = async (
    id,
    userid,
    txid,
    receivingAddress,
    satoshis,
    status
  ) => {
    try {
      let withdrawal = {
        id: id,
        category: "send",
        address: receivingAddress,
        value: satoshis,
        amount: new BigNumber(satoshis).dividedBy(SATS).toNumber(),
        txid: txid,
        status: status,
      };
      let u = await User.findOne({ _id: userid });
      let withdrawals = u.withdrawals;
      let bitcoind_import_exists = 0;
      let tx_exists = 0;
      for (let item of withdrawals) {
        if (item.id == id) tx_exists = 1;
      }
      if (tx_exists)
        await User.findOneAndUpdate(
          { _id: u._id, "withdrawals.id": id },
          { $set: { "withdrawals.$": withdrawal } }
        );
      else
        await User.updateOne(
          { _id: u._id },
          { $push: { withdrawals: withdrawal } }
        );
    } catch (error) {
      throw error;
    }
  };

  cli_node_balance = async (confirmed) => {
    return new Promise((resolve, reject) => {
      lightning
        .listfunds()
        .then((funds) => {
          let outputSum = 0;
          let channelSum = 0;
          for (let x of funds.outputs) {
            if (confirmed) {
              if (x.status == "confirmed") outputSum += x.value;
            } else {
              outputSum += x.value;
            }
          }
          for (let x of funds.channels) channelSum += x.channel_sat;
          resolve({ outputs: outputSum, channels: channelSum });
        })
        .catch((error) => {
          reject(error);
        });
    });
  };

  getTransactions = async (userid) => {
    try {
      const u = await User.findOne({ _id: userid });
      if (!u.depositAddress) {
        let response = await this.generateAddress(userid);
        u.depositAddress = response.address;
      }
      let txs = await this._listtransactions(u.depositAddress);
      let result = [];
      for (let tx of txs.result) {
        // Check for any confirmed deposit transactions to this users' deposit address
        if (tx.confirmations >= 1 && tx.status.confirmed == true) {
          tx.type = "bitcoind_tx";
          let db_tx = await User.findOne({
            _id: userid,
            "transactions.txid": tx.txid,
          });
          if (!db_tx) {
            console.log("\n### No tx found, pushing tx into database now...");
            await User.updateOne(
              { _id: userid },
              { $push: { transactions: tx } }
            );
          } else {
            console.log("\n###Found tx, updating tx in database now...");
            await User.updateOne(
              { _id: userid, "transactions.txid": tx.txid },
              { $set: { "transactions.$.confirmations": tx.confirmations } }
            );
          }
          result.push(tx);
        }
      }

      let user_withdrawals = u.withdrawals;

      for (let withdrawal of user_withdrawals) {
        let withdrawal_txs = await this._listtransactions(withdrawal.address);
        for (let tx of withdrawal_txs.result) {
          // Check for any withdrawal transactions to any address that the user has attempted to withdraw to
          if (
            tx.txid == withdrawal.txid &&
            withdrawal.status == withdraw_status_codes.SUCCESS
          ) {
            if (u.lockedFunds.some((el) => el.pay_req == tx.txid)) {
              console.log(
                "\n\n%%% Electrs seen withdrawal tx = " +
                  tx.txid +
                  " Unlocking funds now..."
              );
              await this.unlockFunds(u._id, tx.txid);
            }
            tx.type = "bitcoind_tx";
            tx.txid = tx.txid;
            tx.category = "send";
            result.push(tx);
          }
        }
      }

      for (let invoice of u.paidInvoices) {
        invoice.type = "paid_invoice";
        delete invoice.payment_hash;
        delete invoice.id;
        delete invoice.decoded;
        delete invoice.payment_preimage;
        delete invoice.routes;
        delete invoice.signature;
        if (invoice.msatoshi && !invoice.internalidpayment) {
          invoice.fee = +invoice.total_fees; // in sats
          invoice.value = Math.trunc(+invoice.msatoshi_sent / 1000); // in sats
        }
        result.push(invoice);
      }

      let received_ln_invoices = await this.getUserInvoices(userid);

      for (let invoice of received_ln_invoices) {
        /*
		Only for the gettxs API call, set type to 'received_ln' -> Internally the only invoice types are 'user_invoice', 'user_hid_invoice' and 'paid_invoice'
		*/
        invoice.type = "received_ln";
        if (invoice.ispaid == true) {
          //invoice.value = invoice.amt // in sats
          result.push(invoice);
        }
      }

      logger.info("getTransactions" + JSON.stringify(result));
      return result;
    } catch (error) {
      logger.error("/getTransactions" + JSON.stringify(error));
      throw error;
    }
  };

  getHeight = (address) => {
    return new Promise(async (resolve, reject) => {
      var url = this.electrs_base_url + "blocks/tip/height";
      try {
        var res = await fetch(url);
        var height = await res.json();
        console.log("\n\n### Fetched current block height = ", height);
        resolve(height);
      } catch (error) {
        console.log(
          "\n\n!#! FATAL: Unable to fetch block height from electrs!\n\n"
        );
        reject(error);
      }
    });
  };

  _listtransactions = async (address) => {
    try {
      let ret = { result: [] };
      let txs;
      if (address.length > 0) txs = await this.getTxs(address);
      else txs = [];
      for (const tx of txs) {
        for (const output of tx.vout) {
          if (output.scriptpubkey_address == address) {
            let tipheight = await this.getHeight();
            ret.result.push({
              category: "receive",
              value: output.value,
              confirmations:
                tx.status.block_height == null
                  ? 0
                  : tipheight - parseInt(tx.status.block_height) + 1,
              status: tx.status,
              address: output.scriptpubkey_address,
              time: tx.status.confirmed == "true" ? 0 : tx.status.block_time,
              txid: tx.txid,
            });
          }
        }
      }
      return ret;
    } catch (error) {
      logger.error("/_listtransactions" + JSON.stringify(error));
      throw error;
    }
  };

  getTxs = (address) => {
    var url = this.electrs_base_url + "address/" + address + "/txs";
    return new Promise(async (resolve, reject) => {
      try {
        var res = await fetch(url);
        var txs = await res.json();
        resolve(txs);
      } catch (error) {
        reject(error);
      }
    });
  };

  setPaymentHashPaid = async (userid, payment_hash) => {
    try {
      await User.findOneAndUpdate(
        { _id: userid, "paymentHashes.payment_hash": payment_hash },
        { $set: { "paymentHashes.$.paid": true } }
      );
      await Invoices.findOneAndUpdate(
        { mongoid: userid, payment_hash: payment_hash },
        { $set: { paid: true } }
      );
      return "Updated payment hash";
    } catch (error) {
      console.log("error : ", error);
      throw error;
    }
  };
}

module.exports = {
  Helper,
};
