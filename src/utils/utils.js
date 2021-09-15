const formatBytes = (bytes, decimals = 2) => {
    if(bytes === 0) return "0 Bytes"

    let k = 1024
    let dm = decimals < 0 ? 0 : decimals
    let sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"]

    let i = Math.floor(Math.log(bytes) / Math.log(k))

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i]
}

function uuidv4() { // Public Domain/MIT
    let d = new Date().getTime();//Timestamp
    let d2 = (performance && performance.now && (performance.now()*1000)) || 0;//Time in microseconds since page-load or 0 if unsupported
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        let r = Math.random() * 16;//random number between 0 and 16
        if(d > 0){//Use timestamp until depleted
            r = (d + r)%16 | 0;
            d = Math.floor(d/16);
        } else {//Use microseconds since page-load if supported
            r = (d2 + r)%16 | 0;
            d2 = Math.floor(d2/16);
        }
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

function isAlphaNumeric(str) {
  var code, i, len;

  for (i = 0, len = str.length; i < len; i++) {
    code = str.charCodeAt(i);
    if (!(code > 47 && code < 58) && // numeric (0-9)
        !(code > 64 && code < 91) && // upper alpha (A-Z)
        !(code > 96 && code < 123)) { // lower alpha (a-z)
      return false;
    }
  }
  return true;
};

function convertWordArrayToUint8Array(wordArray) {
    let arrayOfWords = wordArray.hasOwnProperty("words") ? wordArray.words : []
    let length = wordArray.hasOwnProperty("sigBytes") ? wordArray.sigBytes : arrayOfWords.length * 4
    let uInt8Array = new Uint8Array(length), index=0, word, i

    for(i = 0; i < length; i++){
        word = arrayOfWords[i]

        uInt8Array[index++] = word >> 24
        uInt8Array[index++] = (word >> 16) & 0xff
        uInt8Array[index++] = (word >> 8) & 0xff
        uInt8Array[index++] = word & 0xff
    }

    return uInt8Array
}

const convertUint8ArrayToBinaryString = (u8Array) => {
    let i, len = u8Array.length, b_str = ""

    for (i = 0; i < len; i++){
        b_str += String.fromCharCode(u8Array[i])
    }

    return b_str
}

function _base64ToArrayBuffer(base64) {
    var binary_string = window.atob(base64);
    var len = binary_string.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
}

function base64ArrayBuffer(arrayBuffer) {
  var base64    = ''
  var encodings = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

  var bytes         = new Uint8Array(arrayBuffer)
  var byteLength    = bytes.byteLength
  var byteRemainder = byteLength % 3
  var mainLength    = byteLength - byteRemainder

  var a, b, c, d
  var chunk

  // Main loop deals with bytes in chunks of 3
  for (var i = 0; i < mainLength; i = i + 3) {
    // Combine the three bytes into a single integer
    chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]

    // Use bitmasks to extract 6-bit segments from the triplet
    a = (chunk & 16515072) >> 18 // 16515072 = (2^6 - 1) << 18
    b = (chunk & 258048)   >> 12 // 258048   = (2^6 - 1) << 12
    c = (chunk & 4032)     >>  6 // 4032     = (2^6 - 1) << 6
    d = chunk & 63               // 63       = 2^6 - 1

    // Convert the raw binary segments to the appropriate ASCII encoding
    base64 += encodings[a] + encodings[b] + encodings[c] + encodings[d]
  }

  // Deal with the remaining bytes and padding
  if (byteRemainder == 1) {
    chunk = bytes[mainLength]

    a = (chunk & 252) >> 2 // 252 = (2^6 - 1) << 2

    // Set the 4 least significant bits to zero
    b = (chunk & 3)   << 4 // 3   = 2^2 - 1

    base64 += encodings[a] + encodings[b] + '=='
  } else if (byteRemainder == 2) {
    chunk = (bytes[mainLength] << 8) | bytes[mainLength + 1]

    a = (chunk & 64512) >> 10 // 64512 = (2^6 - 1) << 10
    b = (chunk & 1008)  >>  4 // 1008  = (2^6 - 1) << 4

    // Set the 2 least significant bits to zero
    c = (chunk & 15)    <<  2 // 15    = 2^4 - 1

    base64 += encodings[a] + encodings[b] + encodings[c] + '='
  }
  
  return base64
}

const getRandomArbitrary = (min, max) => {
    return Math.floor(Math.random() * (max - min) + min)
}

const generateRandomString = (length = 32) => {
    return window.btoa(Array.from(window.crypto.getRandomValues(new Uint8Array(length * 2))).map((b) => String.fromCharCode(b)).join("")).replace(/[+/]/g, "").substring(0, length)
}

function toArrayBuffer(buf) {
    var ab = new ArrayBuffer(buf.length);
    var view = new Uint8Array(ab);
    for (var i = 0; i < buf.length; ++i) {
        view[i] = buf[i];
    }
    return ab;
}

const winOrUnixFilePath = (path) => {
  if(appPlatform == "windows"){
    return path.split("/").join("\\")
  }
  else{
    return path.split("\\").join("/")
  }
}

const sortObjectArrayByPropLengthASC = (a) => {
  let keyArray = Object.keys(a)
  let object = {}

  keyArray.sort()

  keyArray.forEach(function(item){
    object[item] = a[item]
  })

  return object
}

const unixTimestamp = () => {
  return Math.floor((+new Date()) / 1000)
}

const getAPIServer = () => {
  let servers = [
    "https://api.filen.io",
    "https://api.filen-1.xyz",
    "https://api.filen-2.xyz",
    "https://api.filen-3.xyz",
    "https://api.filen-4.xyz",
    "https://api.filen-5.xyz"
  ]

  return servers[getRandomArbitrary(0, (servers.length - 1))]
}

const getDownloadServer = () => {
  let servers = [
    "https://down.filen.io",
    "https://down.filen-1.xyz",
    "https://down.filen-2.xyz",
    "https://down.filen-3.xyz",
    "https://down.filen-4.xyz",
    "https://down.filen-5.xyz"
  ]

  return servers[getRandomArbitrary(0, (servers.length - 1))]
}

const getUploadServer = () => {
  let servers = [
    "https://up.filen.io",
    "https://up.filen-1.xyz",
    "https://up.filen-2.xyz",
    "https://up.filen-3.xyz",
    "https://up.filen-4.xyz",
    "https://up.filen-5.xyz"
  ]

  return servers[getRandomArbitrary(0, (servers.length - 1))]
}

const removeIllegalCharsFromString = (str) => {
    if(typeof str !== "string"){
        return str
      }

      if(str.length == 0){
        return str
      }

    str = str.split("'").join("")
    str = str.split('"').join("")
    str = str.split("´").join("")
    str = str.split("`").join("")
    str = str.split("<").join("")
    str = str.split(">").join("")
    str = str.split("!").join("")
    str = str.split("^").join("")
    str = str.split(":").join("")
    str = str.replace(/(<([^>]+)>)/ig, "")

    return str
}

const fileOrFolderNameValid = (name) => {
  let regex = /[<>:"\/\\|?*\x00-\x1F]|^(?:aux|con|clock\$|nul|prn|com[1-9]|lpt[1-9])$/i;

  if(regex.test(name)){
    return true
  }

  return false
}

const escapeHTML = (str) => {
  if(typeof str !== "string"){
    return str
  }

  if(str.length == 0){
    return str
  }

  return str.replace(/(<([^>]+)>)/ig, "")
}

const cleanString = (str) => {
    if(typeof str !== "string"){
    return str
  }

  if(str.length == 0){
    return str
  }
  
    return escapeHTML(str)
}

function buf2hex(buffer) { // buffer is an ArrayBuffer
  return [...new Uint8Array(buffer)].map(x => x.toString(16).padStart(2, '0')).join('');
}

const vkThreadJSONStringify = (obj) => {
  function job(arg){
    return JSON.stringify(arg)
  }

  return new Promise((resolve, reject) => {
    vkthread.exec({
      fn: job,
      args: [obj]
    }).then((data) => {
      return resolve(data)
    }, (err) => {
      return resolve(JSON.stringify({}))
    })
  })
}

const vkThreadJSONParse = (str) => {
  function job(arg){
    return JSON.parse(arg)
  }

  return new Promise((resolve, reject) => {
    vkthread.exec({
      fn: job,
      args: [str]
    }).then((data) => {
      return resolve(data)
    }, (err) => {
      return resolve("")
    })
  })
}

const vkThreadCompareStringLengthJSONStringifyFirstArg = (str1, str2) => {
  function job(arg1, arg2){
    if(JSON.stringify(arg1) == arg2){
      return true
    }

    return false
  }

  return new Promise((resolve, reject) => {
    vkthread.exec({
      fn: job,
      args: [str1, str2]
    }).then((data) => {
      return resolve(data)
    }, (err) => {
      return resolve(true)
    })
  })
}

const deriveKeyFromPassword = async (password, salt, iterations = 200000, hash = "SHA-512", bitLength = 512, returnHex = true) => {
    try{
        var bits = await window.crypto.subtle.deriveBits({
            name: "PBKDF2",
          salt: new TextEncoder().encode(salt),
          iterations: iterations,
          hash: {
            name: hash
          }
        }, await window.crypto.subtle.importKey("raw", new TextEncoder().encode(password), {
            name: "PBKDF2"
        }, false, ["deriveBits"]), bitLength)
    }
    catch(e){
        throw new Error(e)
    }
  
    if(returnHex){
      return buf2hex(bits)
    }

    return bits
}

async function encryptMetadata(data, key){
  data = data.toString()
  key = key.toString()

  if(metadataVersion == 1){ //old deprecated
    try{
      return CryptoJS.AES.encrypt(data, key).toString()
    }
    catch(e){
      console.log(e)

      return ""
    }
  }
  else if(metadataVersion == 2){
    try{
      key = await deriveKeyFromPassword(key, key, 1, "SHA-512", 256, false) //transform variable length input key to 256 bit (32 bytes) as fast as possible since it's already derived and safe

      let iv = generateRandomString(12)
      let string = new TextEncoder().encode(data)

      let encrypted = await window.crypto.subtle.encrypt({
        name: "AES-GCM",
        iv: new TextEncoder().encode(iv)
      }, await window.crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]), string)

      return "002" + iv + base64ArrayBuffer(new Uint8Array(encrypted))
    }
    catch(e){
      console.log(e)

      return ""
    }
  }
}

async function decryptMetadata(data, key){
  data = data.toString()
  key = key.toString()

  let sliced = data.slice(0, 8)

  if(sliced == "U2FsdGVk"){ //old deprecated
    try{
      let dec = CryptoJS.AES.decrypt(data, key).toString(CryptoJS.enc.Utf8)

      return dec
    }
    catch(e){
          return ""
      }
  }
  else{
    let version = data.slice(0, 3)

    if(version == "002"){
      try{
        key = await deriveKeyFromPassword(key, key, 1, "SHA-512", 256, false) //transform variable length input key to 256 bit (32 bytes) as fast as possible since it's already derived and safe

        let iv = new TextEncoder().encode(data.slice(3, 15))
        let encrypted = _base64ToArrayBuffer(data.slice(15))

        let decrypted = await window.crypto.subtle.decrypt({
          name: "AES-GCM",
          iv
        }, await window.crypto.subtle.importKey("raw", key, "AES-GCM", false, ["decrypt"]), encrypted)

        return new TextDecoder().decode(new Uint8Array(decrypted))
      }
      catch(e){
        return ""
      }
    }
    else{
      return ""
    }
  }
}