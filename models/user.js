var mongoose = require("mongoose");
var bcrypt = require("bcryptjs");
require("mongoose-long")(mongoose);

// User Schema
var UserSchema = mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true
  },
  password: {
    type: String,
    required: true
  },
  hid: {
    type: String,
    unique: true
  },
  depositAddress: {
    type: String
  },
  withdrawals: [
    {
      type: mongoose.Schema.Types.Mixed
    }
  ],
  transactions: [
    {
      type: mongoose.Schema.Types.Mixed
    }
  ],
  firebaseTokens:[
    {
      type: String
    }
  ],
  invoices: [
    {
      type: mongoose.Schema.Types.Mixed,
      location: {
        type: {
          type: String,
          enum: ['Point'], // 'location.type' must be 'Point'
          required: true
        },
        coordinates: {
          type: [Number],
          required: true
        }
      }
    }
  ],
  paidInvoices: [
    {
      type: mongoose.Schema.Types.Mixed
    }
  ],
  lockedFunds: [
    {
      type: mongoose.Schema.Types.Mixed
    }
  ],
  paymentHashes: [
    {
      type: mongoose.Schema.Types.Mixed
    }
  ],
  balance: {
    type: mongoose.Schema.Types.Long // User balance in msats ? sats ?
  },
  created:  {type: Date, default: Date.now}
});

UserSchema.index({'invoices.location': '2dsphere'});

UserSchema.pre("save", async function (next) {
  const user = this;
  const hash = await bcrypt.hash(this.password, 10);
  this.password = hash;
  next();
});

UserSchema.methods.isValidPassword = async function (password) {
  const user = this;
  const compare = await bcrypt.compare(password, user.password);
  return compare;
};

var User = (module.exports = mongoose.model("User", UserSchema));
