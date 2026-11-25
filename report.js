/* Печатное оформление диаграммы и ширина изображения при вставке в документ. */
var Report = (function () {
  'use strict';
  const DPI = 300;

  function styleFor(src) {
    const cls = src.classList;
    if (cls.contains('reltext')) return { fill: '#000', stroke: '#fff' };
    if (cls.contains('gbox')) return { fill: 'none', stroke: '#666', 'stroke-opacity': 1 };
    if (cls.contains('body')) return { fill: '#fff', stroke: '#000', 'stroke-width': 1 };
    if (cls.contains('head')) return { fill: '#e6e6e6', stroke: '#000', 'stroke-width': 1 };
    if (src.tagName === 'rect' && src.parentElement.classList.contains('note')) {
      return { fill: '#f5f5f5', 'fill-opacity': 1, stroke: '#666', 'stroke-width': 1 };
    }
    if (cls.contains('pbg')) return { fill: 'none', stroke: '#666' };
    if (cls.contains('edge')) return { stroke: '#000', 'stroke-opacity': 1 };
    if (cls.contains('emark') || src.tagName === 'text') return { fill: '#000', 'fill-opacity': 1 };
    return {};
  }

  function legend(kind, hasLinks) {
    if (kind === 'conceptual') return hasLinks ? [
      'Кратность у сущности относится к одному экземпляру на другом конце.',
      '0..1: ноль или один, 1: ровно один, 0..*: любое количество, 1..*: один или больше'
    ] : [];
    return [
      'PK: первичный ключ, FK: внешний ключ, UQ: уникальное значение, ?: допускается NULL',
      ...(hasLinks ? ['Сплошная линия: обязательный FK, штриховая: допускается NULL'] : [])
    ];
  }

  function setSize(svg, width, height) {
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);
  }

  function vector(figure, widthMm) {
    return setSize(figure.out, widthMm + 'mm', (widthMm * figure.h / figure.w).toFixed(3) + 'mm');
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  async function pngWithDensity(blob) {
    const data = new DataView(await blob.arrayBuffer());
    // Заменяем pHYs, который браузер может записать со своим разрешением.
    const density = new DataView(new ArrayBuffer(21));
    density.setUint32(0, 9);
    density.setUint32(4, 0x70485973); // pHYs
    const pixelsPerMeter = Math.round(DPI / 0.0254);
    density.setUint32(8, pixelsPerMeter);
    density.setUint32(12, pixelsPerMeter);
    density.setUint8(16, 1);
    density.setUint32(17, crc32(new Uint8Array(density.buffer, 4, 13)));
    const contents = [data.buffer.slice(0, 8)];
    for (let i = 8; i < data.byteLength;) {
      const end = i + 12 + data.getUint32(i), type = data.getUint32(i + 4);
      if (type !== 0x70485973) contents.push(data.buffer.slice(i, end));
      if (type === 0x49484452) contents.push(density.buffer); // сразу после IHDR
      i = end;
    }
    return new Blob(contents, { type: 'image/png' });
  }

  async function raster(figure, widthMm) {
    const w = Math.round(widthMm * DPI / 25.4), h = Math.max(1, Math.round(w * figure.h / figure.w));
    if (h > 8192 || w * h > 12000000) {
      throw new Error('Изображение слишком высокое для PNG на выбранной ширине. Выберите SVG, меньшую ширину или видимые группы.');
    }
    const url = URL.createObjectURL(new Blob([setSize(figure.out, w, h)], { type: 'image/svg+xml' }));
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = ERD.el('canvas', { width: w, height: h });
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Браузер не смог создать PNG.');
      return await pngWithDensity(blob);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  return { DPI, styleFor, legend, vector, raster };
})();
