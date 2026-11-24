/** Turns an answer into words a phone voice reads correctly. */

export type Lang = 'ms' | 'en';

type Spoken = {
  lang: Lang;
  text_ms: string;
  text_en: string;
  rows: { label_ms: string; label_en: string; value: string }[];
};

/** "RM 1,508.50" is read as letters and loose digits unless it is spelled out. */
export function speakable(text: string, lang: Lang): string {
  const en = lang === 'en';
  return text
    .replace(/RM\s?(-?)([\d,]+)(?:\.(\d\d))?/g, (_, minus: string, whole: string, sen?: string) => {
      const ringgit = `${minus ? 'minus ' : ''}${whole.replace(/,/g, '')} ringgit`;
      return sen && sen !== '00' ? `${ringgit} ${Number(sen)} sen` : ringgit;
    })
    .replace(/TX-\d+-0*(\d+)/g, en ? 'entry $1' : 'entri $1')
    .replace(/52\+/g, en ? 'more than 52' : 'lebih 52')
    .replace(/—/g, en ? 'none' : 'tiada')
    .replace(/["·]/g, ' ')
    .replace(/\s*\n\s*/g, '. ')
    .replace(/([.?!])\.\s/g, '$1 ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

export function spokenAnswer(a: Spoken): string {
  const en = a.lang === 'en';
  const rows = a.rows.map((r) => `${en ? r.label_en : r.label_ms}: ${r.value}.`);
  return speakable([en ? a.text_en : a.text_ms, ...rows].join('\n'), a.lang);
}
