/**
 * DASHBOARD — Quality Report Modal
 * 
 * Visualizzazione report qualità in markdown.
 */

export async function showQualityReport(slug) {
    const modal = document.getElementById('qualityModal');
    const body = document.getElementById('qualityModalBody');
    const title = document.getElementById('qualityModalTitle');

    modal.classList.add('active');
    body.innerHTML = '<div class="quality-loading">⏳ Caricamento report...</div>';
    title.innerHTML = `<i data-lucide="shield-check" style="width:20px;height:20px;vertical-align:-3px;margin-right:6px"></i>Report Qualità: ${slug}`;
    if (window.lucide) lucide.createIcons();

    try {
        const resp = await fetch(`/api/quality-report/${slug}`);
        const data = await resp.json();

        if (data.error) {
            body.innerHTML = `<div class="quality-error">❌ ${data.error}</div>`;
            return;
        }

        body.innerHTML = `<div class="quality-report-content">${renderMarkdown(data.report)}</div>`;
    } catch (err) {
        body.innerHTML = `<div class="quality-error">❌ Errore: ${err.message}</div>`;
    }
}

export function closeQualityModal() {
    document.getElementById('qualityModal')?.classList.remove('active');
}

export function initQualityModal() {
    document.getElementById('qualityModal')?.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) closeQualityModal();
    });
}

function renderMarkdown(md) {
    if (!md) return '';
    return md
        .replace(/^### (.+)$/gm, '<h4>$1</h4>')
        .replace(/^## (.+)$/gm, '<h3>$1</h3>')
        .replace(/^# (.+)$/gm, '<h2>$1</h2>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
        .replace(/<\/ul>\s*<ul>/g, '')
        .replace(/^\|(.+)\|$/gm, (line) => {
            const cells = line.split('|').filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`);
            return `<tr>${cells.join('')}</tr>`;
        })
        .replace(/(<tr>.*<\/tr>)/gs, '<table class="quality-table">$1</table>')
        .replace(/<\/table>\s*<table[^>]*>/g, '')
        .replace(/^(?!<[hultd])(.*\S.*)$/gm, '<p>$1</p>')
        .replace(/<p>---<\/p>/g, '<hr>')
        .replace(/<p><tr>/g, '<tr>')
        .replace(/<\/tr><\/p>/g, '</tr>');
}

// Global expose
window.showQualityReport = showQualityReport;
