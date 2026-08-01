var sfpData = new Uint8Array(256);
var sfpSlot = 0;

function hex(b) { return (b >> 4).toString(16) + (b & 0xf).toString(16); }

function pwArg() {
  var pw = document.getElementById('pwinput').value.trim();
  if (!pw) return '';
  if (!/^[0-9a-fA-F]{8}$/.test(pw)) { alert('Password must be 8 hex digits.'); return ''; }
  return ' --pw ' + pw;
}

async function postCmd(cmd) {
  try {
    const response = await fetch('/cmd', { method: 'POST', body: cmd });
    if (!response.ok) { alert('Command failed: ' + cmd); return false; }
    return true;
  } catch(err) {
    console.error(err);
    return false;
  }
}

function loadEeprom() {
  sfpSlot = parseInt(document.getElementById('slotsel').value);
  var xhttp = new XMLHttpRequest();
  xhttp.onreadystatechange = function() {
    if (this.readyState == 4 && this.status == 200) {
      try {
        var j = JSON.parse(xhttp.responseText);
        if (j.data) {
          for (var i = 0; i < 256; i++) sfpData[i] = parseInt(j.data.substr(i * 2, 2), 16);
          showEeprom();
          showSfpInfo();
        }
      } catch (e) { alert('Failed to load EEPROM.'); }
    }
  };
  xhttp.open("GET", "/sfp_eeprom.json?slot=" + sfpSlot, true);
  xhttp.timeout = 5000;
  sendXHTTP(xhttp);
}

function showEeprom() {
  var h = '<table style="border-collapse:collapse"><tr><th></th>';
  for (var c = 0; c < 16; c++) h += '<th style="width:24px;font-size:10px;color:#888">' + c.toString(16) + '</th>';
  h += '<th style="width:120px;font-size:10px;color:#888">ASCII</th></tr>';
  for (var r = 0; r < 16; r++) {
    h += '<tr><td style="font-size:10px;color:#888">' + hex(r << 4) + '</td>';
    var ascii = '';
    for (var c = 0; c < 16; c++) {
      var b = sfpData[r * 16 + c];
      h += '<td id="b' + (r * 16 + c) + '" style="border:1px solid #ddd;text-align:center;cursor:pointer;font-size:11px"';
      h += ' onclick="editByte(' + (r * 16 + c) + ')" title="Click to edit">' + hex(b) + '</td>';
      ascii += (b >= 32 && b < 127) ? String.fromCharCode(b) : '.';
    }
    h += '<td style="border:1px solid #ddd;padding-left:8px;font-size:11px;color:#666">' + ascii + '</td></tr>';
  }
  h += '</table>';
  document.getElementById('hexdump').innerHTML = h;
  document.getElementById('hexdump').style.display = 'block';
}

function showSfpInfo() {
  function readStr(start, end) {
    var s = '';
    for (var i = start; i < end; i++) s += String.fromCharCode(sfpData[i]);
    return s.replace(/\0/g, '').trim();
  }
  var v = readStr(20, 36), pn = readStr(40, 56), sn = readStr(68, 84);
  document.getElementById('info').innerHTML = '<b>Vendor:</b> ' + v + ' | <b>PN:</b> ' + pn + ' | <b>SN:</b> ' + sn + ' | <b>Type:</b> 0x' + hex(sfpData[3]);
}

async function editByte(offset) {
  var cell = document.getElementById('b' + offset);
  var oldVal = sfpData[offset];
  var newVal = prompt('Edit byte 0x' + hex(offset) + ' (0x00-0xFF):', hex(oldVal));
  if (newVal === null) return;
  if (newVal.startsWith('0x')) newVal = newVal.substring(2);
  var v = parseInt(newVal, 16);
  if (isNaN(v) || v < 0 || v > 255) { alert('Invalid value'); return; }
  if (await postCmd('sfp ' + (sfpSlot + 1) + ' write ' + hex(offset) + ' ' + hex(v) + pwArg())) {
    sfpData[offset] = v;
    cell.textContent = hex(v);
    cell.style.backgroundColor = '#ff8';
    setTimeout(function() { cell.style.backgroundColor = ''; }, 2000);
  }
}

async function patchEeprom() {
  if (!confirm('Patch SFP ' + (sfpSlot + 1) + ' EEPROM (FC->Ethernet)?')) return;
  if (await postCmd('sfp ' + (sfpSlot + 1) + ' patch' + pwArg())) loadEeprom();
}

async function fixChecksum() {
  if (!confirm('Fix checksums on SFP ' + (sfpSlot + 1) + '?')) return;
  if (await postCmd('sfp ' + (sfpSlot + 1) + ' checksum --fix' + pwArg())) loadEeprom();
}

async function saveBackup() {
  if (!confirm('Save current SFP EEPROM to flash backup?')) return;
  await postCmd('sfp ' + (sfpSlot + 1) + ' save');
}

async function restoreBackup() {
  if (!confirm('Restore EEPROM from flash backup?')) return;
  if (await postCmd('sfp ' + (sfpSlot + 1) + ' restore')) loadEeprom();
}

function downloadBin() {
  function readStr(start, end) {
    var s = '';
    for (var i = start; i < end; i++) s += String.fromCharCode(sfpData[i]);
    return s.replace(/\0/g, '').trim().replace(/\s+/g, '_');
  }
  var vendor = readStr(20, 36);
  var pn = readStr(40, 56);
  var name = (vendor ? vendor + '_' : '') + (pn ? pn : 'sfp' + (sfpSlot + 1) + '_eeprom') + '.bin';
  var buf = new ArrayBuffer(256);
  var view = new Uint8Array(buf);
  for (var i = 0; i < 256; i++) view[i] = sfpData[i];
  var blob = new Blob([buf], {type: 'application/octet-stream'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

async function uploadBin(input) {
  var file = input.files[0];
  if (!file) return;
  if (file.size != 256) { alert('File must be exactly 256 bytes.'); return; }
  if (!confirm('Write ' + file.name + ' to SFP ' + (sfpSlot + 1) + ' EEPROM?')) return;
  var reader = new FileReader();
  reader.onload = async function(e) {
    var data = new Uint8Array(e.target.result);
    var hexStr = '';
    for (var i = 0; i < 256; i++) hexStr += hex(data[i]);
    if (await postCmd('sfp ' + (sfpSlot + 1) + ' bulk ' + hexStr + pwArg())) loadEeprom();
  };
  reader.readAsArrayBuffer(file);
}

window.addEventListener("load", function() {
  loadEeprom();
});
