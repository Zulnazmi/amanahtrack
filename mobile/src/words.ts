import { say } from './lang';

/**
 * Wording for what the server stores in English.
 *
 * Stored text is sealed, so it is never changed. Only known phrases are shown
 * in Malay; anything else, such as what a person typed, is shown as it is.
 */

export const PURPOSES: { code: string; ms: string; en: string; group: 'asnaf' | 'mosque' | 'people' }[] = [
  { code: 'utilities', ms: 'Bil air, elektrik, internet', en: 'Water, power, internet', group: 'mosque' },
  { code: 'mosque_maintenance', ms: 'Baik pulih masjid', en: 'Mosque repairs', group: 'mosque' },
  { code: 'staff_salary', ms: 'Gaji petugas', en: 'Staff pay', group: 'mosque' },
  { code: 'admin_cost', ms: 'Kos pejabat', en: 'Office costs', group: 'mosque' },
  { code: 'capital_project', ms: 'Projek pembangunan', en: 'Building project', group: 'mosque' },
  { code: 'education', ms: 'Kelas agama', en: 'Religious classes', group: 'people' },
  { code: 'ramadan_programme', ms: 'Program Ramadan', en: 'Ramadan programme', group: 'people' },
  { code: 'orphan_welfare', ms: 'Anak yatim', en: 'Orphans', group: 'people' },
  { code: 'funeral_support', ms: 'Urusan kematian', en: 'Funeral support', group: 'people' },
  { code: 'asnaf_fakir', ms: 'Fakir', en: 'Fakir (destitute)', group: 'asnaf' },
  { code: 'asnaf_miskin', ms: 'Miskin', en: 'Miskin (poor)', group: 'asnaf' },
  { code: 'asnaf_amil', ms: 'Amil', en: 'Amil (zakat workers)', group: 'asnaf' },
  { code: 'asnaf_muallaf', ms: 'Muallaf', en: 'Muallaf (new Muslims)', group: 'asnaf' },
  { code: 'asnaf_riqab', ms: 'Riqab', en: 'Riqab (freeing from bondage)', group: 'asnaf' },
  { code: 'asnaf_gharimin', ms: 'Gharimin', en: 'Gharimin (in debt)', group: 'asnaf' },
  { code: 'asnaf_fisabilillah', ms: 'Fisabilillah', en: 'Fisabilillah', group: 'asnaf' },
  { code: 'asnaf_ibnussabil', ms: 'Ibnus sabil', en: 'Ibnus sabil (stranded traveller)', group: 'asnaf' },
];

export function purposeName(code: string): string {
  const p = PURPOSES.find((x) => x.code === code);
  return p ? say(p.ms, p.en) : code;
}

type Rule = [RegExp, string];

const MALAY: Rule[] = [
  // records
  [/^Witnessed count, (\d+) witness\(es\)$/, 'Kiraan tabung, $1 saksi'],
  [/^Count adjustment: counted (.+) against estimate (.+)$/, 'Pelarasan kiraan: dikira $1, anggaran $2'],
  [
    /^Reversal of (\S+): ([\s\S]*) \(requested by (.+), approved by (.+)\)$/,
    'Pembetulan $1: $2 (diminta oleh $3, diluluskan oleh $4)',
  ],
  [/^Reversal of (\S+): ([\s\S]*)$/, 'Pembetulan $1: $2'],
  [/^([\s\S]*) \(requested by (.+), approved by (.+)\)$/, '$1 (diminta oleh $2, diluluskan oleh $3)'],
  // alert titles
  [/^Box door opened$/, 'Pintu tabung dibuka'],
  [/^Vibration while the box is closed$/, 'Gegaran semasa tabung tertutup'],
  [/^Box went offline$/, 'Tabung terputus sambungan'],
  [/^Box door left open$/, 'Pintu tabung dibiarkan terbuka'],
  [/^Unexplained weight in the tray$/, 'Berat luar biasa dalam tabung'],
  [/^Tray was emptied$/, 'Tabung dikosongkan'],
  [/^Possible tampering with the box$/, 'Tabung mungkin diusik'],
  [/^Count came in RM (\S+) short$/, 'Kiraan kurang RM $1'],
  [/^Count came in RM (\S+) over$/, 'Kiraan lebih RM $1'],
  // alert details
  [/^The door switch reported the door open\.$/, 'Suis pintu mengesan pintu dibuka.'],
  [/^The door has been open for more than 2 minutes\.$/, 'Pintu terbuka lebih daripada 2 minit.'],
  [/^Vibration detected$/, 'Gegaran dikesan'],
  [/^(\d+) pulses$/, '$1 gegaran'],
  [/^(\d+) pulses \(door open, counting\)$/, '$1 gegaran (pintu terbuka, sedang dikira)'],
  [/^(\d+) pulses \(repeat, grouped with the last alert\)$/, '$1 gegaran (ulangan amaran tadi)'],
  [/^Vibration detected \(door open, counting\)$/, 'Gegaran dikesan (pintu terbuka, sedang dikira)'],
  [/^Vibration detected \(repeat, grouped with the last alert\)$/, 'Gegaran dikesan (ulangan amaran tadi)'],
  [/^No heartbeat since (\S+) UTC\.$/, 'Tiada isyarat sejak $1 UTC.'],
  // checks
  [/^Entry content matches its seal$/, 'Kandungan rekod tidak berubah'],
  [/^Amounts, funds, time and description recompute to the seal$/, 'Jumlah, dana, masa dan catatan sama seperti asal'],
  [/^This entry was changed after it was sealed$/, 'Rekod ini diubah selepas disimpan'],
  [/^Follows the previous entry$/, 'Bersambung dengan rekod sebelumnya'],
  [/^Points at the seal before it$/, 'Sambungan betul'],
  [/^Does not follow the previous seal$/, 'Sambungan terputus'],
  [/^Seal hash recomputes$/, 'Kod semakan sepadan'],
  [/^SHA-256\(prev : payload : seq\) matches$/, 'Dikira semula dan sama'],
  [/^Seal hash was altered$/, 'Kod semakan telah diubah'],
  [/^Photo matches its SHA-256$/, 'Gambar tidak berubah'],
  [/^No photo attached$/, 'Tiada gambar'],
  [/^A photo was recorded with this alert but is now missing$/, 'Gambar asal sudah tiada'],
  [/^Stored photo hashes to the recorded value$/, 'Gambar sama seperti semasa diterima'],
  [/^Stored photo no longer matches the hash recorded on arrival$/, 'Gambar tidak lagi sama seperti semasa diterima'],
  [/^Signed by the box$/, 'Dihantar oleh tabung ini'],
  [/^Raised by the platform, not a box$/, 'Dikeluarkan oleh sistem, bukan tabung'],
  [/^HMAC valid for (.+)$/, 'Tandatangan $1 sah'],
  [/^Signature does not verify$/, 'Tandatangan tidak sah'],
  [/^Alert content matches its seal$/, 'Kandungan amaran tidak berubah'],
  [/^Title, detail, device and photo hash all recompute to the seal$/, 'Semua butiran sama seperti asal'],
  [/^Alert content was changed after it was sealed$/, 'Amaran ini diubah selepas disimpan'],
  [/^Chain links intact$/, 'Susunan amaran lengkap'],
  [/^Linked to the previous alert and the next one$/, 'Bersambung dengan amaran sebelum dan selepas'],
  [/^Linked to the previous alert \(latest alert\)$/, 'Bersambung dengan amaran sebelum (terkini)'],
  [/^Does not follow the previous alert in the chain$/, 'Tidak bersambung dengan amaran sebelumnya'],
  [/^The next alert no longer points at this one$/, 'Amaran berikutnya tidak lagi bersambung'],
];

export function stored(text: string): string {
  for (const [from, to] of MALAY) {
    if (from.test(text)) return say(text.replace(from, to), text);
  }
  return text;
}
