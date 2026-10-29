/**
 * 出力言語の簡易判定。
 * Claude の出力がプロンプトの指示を無視して英語・中国語・韓国語になることがあるため、
 * 物語の文章（タイトル・要約・セリフ）は「日本語の文字が十分あるか」を見て、足りなければ 1 回だけ作り直させる。
 */

/** 文字のうち日本語（ひらがな・カタカナ・漢字）の割合。記号・数字・空白は数えない */
export function japaneseRatio(text: string): number {
  let kana = 0;
  let kanji = 0;
  let letters = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    const isKana = (cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0xff66 && cp <= 0xff9f);
    const isKanji = (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf);
    const isHangul = cp >= 0xac00 && cp <= 0xd7af;
    const isLatin = (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a) || (cp >= 0xc0 && cp <= 0x24f);
    if (isKana) { kana += 1; letters += 1; }
    else if (isKanji) { kanji += 1; letters += 1; }
    else if (isHangul || isLatin) letters += 1;
  }
  if (!letters) return 1;
  // 漢字ばかりで仮名が無い文章は中国語とみなす（日本語の文には必ず仮名が混ざる）
  if (kanji >= 6 && kana === 0) return 0;
  return (kana + 0.6 * kanji) / letters;
}

/** 日本語の文章として妥当か（空文字は妥当扱い） */
export function looksJapanese(text: string, min = 0.3): boolean {
  if (!text.trim()) return true;
  return japaneseRatio(text) >= min;
}

/** 作り直しのときにプロンプトへ足す注意 */
export const RETRY_IN_JAPANESE = '\n\n## 重要\n前回の出力は日本語ではありませんでした。タイトル・要約・シーン・セリフ・説明など文章はすべて «日本語» で書き直してください（画像生成用の imagePrompt だけ英語）。';
