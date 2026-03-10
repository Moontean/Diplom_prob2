(async function () {
  const grid = document.getElementById('examples-grid');
  if (!grid) return;
  try {
    const res = await fetch('/api/templates/examples');
    if (!res.ok) throw new Error('Не удалось загрузить примеры шаблонов');
    const items = await res.json();
    if (!Array.isArray(items) || items.length === 0) {
      grid.innerHTML = '<div style="color:#6b7280; text-align:center;">Примеры не найдены</div>';
      return;
    }

    const frag = document.createDocumentFragment();
    items.forEach((it) => {
      const card = document.createElement('div');
      card.style.background = 'white';
      card.style.borderRadius = '0.75rem';
      card.style.boxShadow = '0 4px 6px -1px rgba(0,0,0,0.1)';
      card.style.padding = '1rem';
      card.style.display = 'flex';
      card.style.flexDirection = 'column';
      card.style.gap = '0.75rem';

      const preview = document.createElement('div');
      preview.style.height = '180px';
      preview.style.borderRadius = '0.5rem';
      preview.style.background = it.ext === 'pdf' ? 'linear-gradient(135deg,#ef4444,#f59e0b)' : 'linear-gradient(135deg,#2563eb,#10b981)';
      preview.style.display = 'flex';
      preview.style.alignItems = 'center';
      preview.style.justifyContent = 'center';
      preview.style.color = 'white';
      preview.style.fontWeight = '600';
      preview.style.fontSize = '1.05rem';
      preview.textContent = it.ext.toUpperCase();

      const title = document.createElement('h3');
      title.style.margin = '0';
      title.style.color = '#111827';
      title.style.fontSize = '1rem';
      title.textContent = it.displayName;

      const meta = document.createElement('div');
      meta.style.color = '#6b7280';
      meta.style.fontSize = '0.85rem';
      meta.textContent = `${it.ext.toUpperCase()} • ${Math.max(1, Math.round((it.size || 0) / 1024))} KB`;

      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.gap = '0.5rem';
      actions.style.marginTop = '0.25rem';

      const openBtn = document.createElement('a');
      openBtn.className = 'btn btn-outline';
      openBtn.href = it.url;
      openBtn.target = '_blank';
      openBtn.rel = 'noopener noreferrer';
      openBtn.textContent = 'Открыть';

      const useBtn = document.createElement('a');
      useBtn.className = 'btn btn-primary';
      useBtn.textContent = 'Использовать справа';
      useBtn.href = `/pages/pdf-converter?example=${encodeURIComponent(it.url)}`;

      actions.appendChild(openBtn);
      actions.appendChild(useBtn);

      card.appendChild(preview);
      card.appendChild(title);
      card.appendChild(meta);
      card.appendChild(actions);

      frag.appendChild(card);
    });

    grid.appendChild(frag);
  } catch (e) {
    grid.innerHTML = `<div style="color:#ef4444; text-align:center;">${e.message || 'Ошибка загрузки'}</div>`;
  }
})();
