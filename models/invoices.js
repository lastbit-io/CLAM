var mongoose = require("mongoose");

// Invoice Schema
var InvoiceSchema = mongoose.Schema({
  payment_hash:{
  	type: String,
  	required: true,
  	unique: true
  },
  bolt11:{
    type: String,
    required: true,
    unique: true
  },
  mongoid: {
      type: String,
      required: true
  },
  hid: {
  	type: String,
  	required: true
  },
  label: {
    type: String,
    required: true,
    unique: true
  },
  amount: {
    type: Number //sats
  },
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
  },
  expiresAt: {
    type: Date 
  },
  paid: {
    type: Boolean
  }
});

InvoiceSchema.index({'location': '2dsphere'});

InvoiceSchema.methods.isExpired = async function () {
  const user = this;
  let dt = new Date(this.created);
  dt.setSeconds(dt.getSeconds() + this.expiresIn);
  if(new Date() > dt) return 1;
  return 0;
};

var Invoice = (module.exports = mongoose.model("Invoices", InvoiceSchema));

