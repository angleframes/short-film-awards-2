/* Campus Track student-verification upload (shared by index.html and submit.html).
   Client checks are for fast feedback only — the campus-proof Edge Function re-validates everything. */
window.CampusProof = (function () {
    var MAX_BYTES = 5 * 1024 * 1024;
    var OK_EXT = { pdf: 'pdf', jpg: 'jpeg', jpeg: 'jpeg' };
    var BAD_INNER = ['exe', 'js', 'mjs', 'html', 'htm', 'php', 'sh', 'bat', 'cmd', 'com', 'scr', 'msi', 'dll', 'jar',
        'vbs', 'ps1', 'py', 'svg', 'xml', 'zip', 'rar', '7z', 'gz', 'apk', 'hta', 'lnk'];

    var cfg = null;
    var state = { proofId: null, uploading: false, label: '' };
    var els = {};

    function isCampus() {
        return !!els.select && (els.select.value || '').trim().toLowerCase() === 'campus';
    }

    function toggle() {
        if (els.group) els.group.hidden = !isCampus();
    }

    function setStatus(kind, text) {
        els.status.className = 'campus-proof-status' + (kind ? ' is-' + kind : '');
        els.status.textContent = text || '';
    }

    function fmtSize(n) {
        return n >= 1024 * 1024 ? (n / 1048576).toFixed(2) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
    }

    function nameError(name) {
        var parts = String(name || '').toLowerCase().split('.');
        if (parts.length < 2 || !parts[0].trim()) return 'Only PDF or JPG files are accepted.';
        if (!OK_EXT[parts[parts.length - 1]]) return 'Only PDF or JPG files are accepted.';
        for (var i = 1; i < parts.length - 1; i++) {
            if (BAD_INNER.indexOf(parts[i].trim()) !== -1) return 'This file appears to be disguised. Please upload a genuine PDF or JPG.';
        }
        return null;
    }

    function sniff(file) {
        return file.slice(0, 5).arrayBuffer().then(function (buf) {
            var b = new Uint8Array(buf);
            if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return 'pdf';
            if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
            return null;
        });
    }

    function onPick() {
        var file = els.input.files && els.input.files[0];
        if (!file) return;
        state.proofId = null;
        state.label = '';
        els.pickTitle.textContent = 'Choose file';

        var err = nameError(file.name);
        if (!err && file.size === 0) err = 'The selected file is empty.';
        if (!err && file.size > MAX_BYTES) err = 'File is larger than 5 MB (' + fmtSize(file.size) + '). Please upload a smaller PDF or JPG.';
        if (err) { reject(err); return; }

        sniff(file).then(function (kind) {
            var ext = file.name.toLowerCase().split('.').pop();
            if (!kind) return reject('This file is not a genuine PDF or JPG.');
            if (kind !== OK_EXT[ext]) return reject("The file's contents do not match its extension. Please upload a genuine PDF or JPG.");
            upload(file);
        }).catch(function () { reject('Could not read the selected file. Please try again.'); });
    }

    function reject(msg) {
        els.input.value = '';
        setStatus('error', msg);
        if (cfg.notify) cfg.notify(msg);
    }

    function upload(file) {
        state.uploading = true;
        els.group.classList.add('is-busy');
        setStatus('pending', 'Uploading and verifying ' + file.name + '…');
        var fd = new FormData();
        fd.append('file', file, file.name);
        fetch(cfg.endpoint, {
            method: 'POST',
            headers: { apikey: cfg.anonKey, Authorization: 'Bearer ' + cfg.anonKey },
            body: fd
        }).then(function (res) {
            return res.json().catch(function () { return { status: 'error', message: 'Upload failed (' + res.status + ').' }; });
        }).then(function (resp) {
            if (!resp || resp.status !== 'success' || !resp.proof_id) {
                reject((resp && resp.message) || 'Upload failed. Please try again.');
                return;
            }
            state.proofId = resp.proof_id;
            state.label = (resp.type === 'pdf' ? 'PDF' : 'JPG') + ' · ' + fmtSize(resp.size || file.size);
            els.pickTitle.textContent = 'Replace file';
            setStatus('ok', '✓ ' + file.name + ' — verified (' + state.label + ')');
        }).catch(function () {
            reject('Network error while uploading. Please check your connection and try again.');
        }).then(function () {
            state.uploading = false;
            els.group.classList.remove('is-busy');
        });
    }

    return {
        init: function (c) {
            cfg = c;
            els.select = document.getElementById(c.selectId);
            els.group = document.getElementById('campusProofGroup');
            els.input = document.getElementById('campusProofInput');
            els.status = document.getElementById('campusProofStatus');
            els.pickTitle = document.getElementById('campusProofPickTitle');
            if (!els.select || !els.group || !els.input) return;
            els.select.addEventListener('change', toggle);
            els.input.addEventListener('change', onPick);
            toggle();
        },
        toggle: toggle,
        isCampus: isCampus,
        // Returns a user-facing message when the Campus requirement is not met, else null.
        check: function () {
            if (!isCampus()) return null;
            if (state.uploading) return 'Please wait for your verification document to finish uploading.';
            if (!state.proofId) return 'Please upload your Campus Category verification document (PDF or JPG, max 5 MB).';
            return null;
        },
        payload: function () {
            return isCampus() && state.proofId ? { campusProofId: state.proofId } : {};
        },
        summary: function () {
            if (!isCampus()) return null;
            return state.proofId ? 'Uploaded ✓ (' + state.label + ')' : 'Missing';
        }
    };
})();
