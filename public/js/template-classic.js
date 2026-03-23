(() => {
    function getData() {
        try {
            const url = new URL(window.location.href);
            const raw = url.searchParams.get('data');
            if (raw) return JSON.parse(decodeURIComponent(raw));
        } catch (_) { }
        try { const local = localStorage.getItem('cvBuilderData'); if (local) return JSON.parse(local); } catch (_) { }
        return {};
    }

    function render(data) {
        try { window.parent.postMessage({ type: 'cv-ready' }, window.location.origin); } catch (_) { }
        const p = data.personalInfo || {};
        const nameEl = document.getElementById('name');
        const contactsEl = document.getElementById('contacts');
        const photoWrap = document.getElementById('photoWrap');
        const photoImg = document.getElementById('photo');
        const empList = document.getElementById('employmentList');
        const eduList = document.getElementById('educationList');
        const skillsList = document.getElementById('skillsList');

        const nameParts = [p['given-name'] || p.givenName, p['family-name'] || p.familyName].filter(Boolean);
        nameEl.textContent = nameParts.join(' ') || (data.title || 'Моё резюме');

        contactsEl.innerHTML = '';
        const contactItems = [p.email, p.phone, (p.address || p.city), p.website, p.linkedin].filter(Boolean);
        contactItems.forEach(txt => {
            const span = document.createElement('span');
            span.className = 'chip';
            span.textContent = txt;
            contactsEl.appendChild(span);
        });

        if (p.photo) { photoImg.src = p.photo; photoWrap.style.display = 'block'; } else { photoWrap.style.display = 'none'; }

        empList.innerHTML = '';
        empList.className = 'list';
        (Array.isArray(data.employment) ? data.employment : []).forEach(item => {
            const div = document.createElement('div');
            div.className = 'item';
            const period = [item.start_date || item.startDate, item.current ? 'по наст. время' : (item.end_date || item.endDate || '')].filter(Boolean).join(' — ');
            div.innerHTML = `
                ${period ? `<div class=\"period\">${period}</div>` : ''}
                <div class=\"position\">${item.position || ''}</div>
                <div class=\"company\">${item.company || ''}</div>
                ${item.description ? `<div class=\"desc\">${item.description}</div>` : ''}
            `;
            empList.appendChild(div);
        });

        eduList.innerHTML = '';
        eduList.className = 'list';
        (Array.isArray(data.education) ? data.education : []).forEach(item => {
            const years = [item.start_year || item.startYear, item.end_year || item.endYear].filter(Boolean).join(' — ');
            const div = document.createElement('div');
            div.className = 'item';
            div.innerHTML = `
                ${years ? `<div class=\"period\">${years}</div>` : ''}
                <div class=\"position\">${item.school || ''}</div>
                <div class=\"company\">${[item.degree, item.level].filter(Boolean).join(' · ')}</div>
            `;
            eduList.appendChild(div);
        });

        skillsList.innerHTML = '';
        (Array.isArray(data.skills) ? data.skills : []).forEach(item => {
            const chip = document.createElement('span');
            chip.className = 'chip';
            chip.textContent = `${item.skill || ''}${item.level ? ' · ' + item.level : ''}`;
            skillsList.appendChild(chip);
        });
    }

    window.addEventListener('message', (ev) => {
        const msg = ev.data;
        if (!msg) return;
        if (msg.type === 'cv-data') render(msg.payload || {});
        if (msg.type === 'export-png') exportPng();
        if (msg.type === 'export-pdf') exportPdf();
    });

    function exportPng() {
        const root = document.getElementById('page-root');
        html2canvas(root, { backgroundColor: '#ffffff', scale: 2 }).then(canvas => {
            const url = canvas.toDataURL('image/png');
            window.parent.postMessage({ type: 'export-png-result', dataUrl: url }, window.location.origin);
        }).catch(e => {
            window.parent.postMessage({ type: 'export-png-result', dataUrl: null, error: e?.message }, window.location.origin);
        });
    }

    function exportPdf() {
        const root = document.getElementById('page-root');
        html2canvas(root, { backgroundColor: '#ffffff', scale: 2 }).then(canvas => {
            const imgData = canvas.toDataURL('image/jpeg', 0.95);
            const { jsPDF } = window.jspdf || {};
            if (!jsPDF) throw new Error('jsPDF недоступен');
            const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
            const pageWidth = pdf.internal.pageSize.getWidth();
            const pageHeight = pdf.internal.pageSize.getHeight();
            const scale = Math.min(pageWidth / canvas.width, pageHeight / canvas.height);
            const imgWidth = canvas.width * scale;
            const imgHeight = canvas.height * scale;
            const x = (pageWidth - imgWidth) / 2;
            const y = 24;
            pdf.addImage(imgData, 'JPEG', x, y, imgWidth, imgHeight);
            const url = URL.createObjectURL(pdf.output('blob'));
            window.parent.postMessage({ type: 'export-pdf-result', url }, window.location.origin);
        }).catch(e => {
            window.parent.postMessage({ type: 'export-pdf-result', url: null, error: e?.message }, window.location.origin);
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        render(getData());
    });
})();
