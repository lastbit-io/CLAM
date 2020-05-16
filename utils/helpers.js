module.exports = {
  helpers: function () {
    var functions = {};

    functions.isProduction = function () {
      return (
        process.env.NODE_ENV == "PRODUCTION" || process.env.NODE_ENV == "PROD"
      );
    };

    functions.removeFromBody = function (req, childToDelete) {
      if (
        req.hasOwnProperty("body") &&
        req.body.hasOwnProperty(childToDelete)
      ) {
        delete req.body[childToDelete];
        return true;
      }
      return false;
    };

    functions.logger = function (label, message) {
      logger.log({
        level: "info",
        label: label,
        message: JSON.stringify(message),
      });
    };

    /* response-wrapper */
    functions.responseWrapper = function (result, message, payload) {
      this.result = result;
      this.message = message;
      this.payload = payload;
    };

    functions.errorBadAuth = function (res) {
      return res
        .status(401)
        .send(new functions.responseWrapper(-1, "Not authorized", {}));
    };

    functions.errorNotEnoughBalance = function (res) {
      return res
        .status(400)
        .send(new functions.responseWrapper(-2, "Not enough balance", {}));
    };

    functions.errorNotAValidInvoice = function (res) {
      return res
        .status(400)
        .send(new functions.responseWrapper(-4, "Invalid invoice", {}));
    };

    functions.errorBadArguments = function (res) {
      return res
        .status(400)
        .send(new functions.responseWrapper(-5, "Bad arguments", {}));
    };

    functions.errorGeneralServerError = function (res) {
      return res
        .status(500)
        .send(new functions.responseWrapper(-6, "Server fault", {}));
    };

    functions.errorCln = function (res) {
      return res
        .status(400)
        .send(new functions.responseWrapper(-7, "Lightning failed", {}));
    };

    functions.alreadyPaid = function (res) {
      return res
        .status(400)
        .send(new functions.responseWrapper(-8, "Invoice already paid", {}));
    };

    functions.errorTryAgainLater = function (res) {
      return res
        .status(500)
        .send(new functions.responseWrapper(-9, "Try again in 5 minutes", {}));
    };

    functions.errorPaymentFailed = function (res, err) {
      return res
        .status(500)
        .send(
          new functions.responseWrapper(-10, "Payment failed", { error: err })
        );
    };

    functions.handleWithdrawFailedError = function (res, err) {
      return res.status(500).send(
        new functions.responseWrapper(-11, "Withdrawal failed", {
          error: err,
        })
      );
    };

    functions.genericError = function (res, err) {
      return res
        .status(500)
        .send(
          new functions.responseWrapper(-12, "Generic error", { error: err })
        );
    };

    functions.duplicateInvoice = function (res) {
      return res
        .status(400)
        .send(new functions.responseWrapper(-13, "Duplicate invoice", {}));
    };

    functions.mongoError = function (res) {
      return res
        .status(503)
        .send(new functions.responseWrapper(-14, "Database error", {}));
    };

    functions.paymentInProgress = function (res) {
      return res
        .status(400)
        .send(
          new functions.responseWrapper(-15, "Invoice payment in progress", {})
        );
    };

    functions.selfPayment = function (res) {
      return res
        .status(400)
        .send(new functions.responseWrapper(-16, "Cannot pay self", {}));
    };

    functions.badRecipient = function (res) {
      return res
        .status(400)
        .send(
          new functions.responseWrapper(-17, "Recipient does not exist", {})
        );
    };

    functions.errorInternalPayment = function (res) {
      return res
        .status(400)
        .send(new functions.responseWrapper(-18, "Internal payment error", {}));
    };

    functions.invalidRecipient = function (res) {
      return res
        .status(400)
        .send(new functions.responseWrapper(-19, "Invalid Recipient", {}));
    };

    functions.duplicateHid = function (res) {
      return res
        .status(400)
        .send(new functions.responseWrapper(-20, "ID exists", {}));
    };

    functions.errorInternalWithdrawal = function (res) {
      return res
        .status(400)
        .send(
          new functions.responseWrapper(
            -21,
            "Internal withdrawal not permitted",
            {}
          )
        );
    };
    return functions;
  },
};
