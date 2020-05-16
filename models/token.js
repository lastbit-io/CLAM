var mongoose = require("mongoose");

// WARNING: DEPRECATED
// Token Schema
var TokenSchema = mongoose.Schema({
  jwt: {
    type: String,
    required: true,
    unique: true
  },
  created: {
    type: Date,
  },
  owner: {
    type: String
  },
  expiresIn: {
    type: Number //In seconds
  },
  expired: {
    type: Boolean
  },
  blacklisted: {
    type: Boolean
  }
});

TokenSchema.methods.isExpired = async function () {
  const user = this;
  let dt = new Date(this.created);
  dt.setSeconds(dt.getSeconds() + this.expiresIn);
  if(new Date() > dt) return 1;
  return 0;
};

var Token = (module.exports = mongoose.model("Token", TokenSchema));
