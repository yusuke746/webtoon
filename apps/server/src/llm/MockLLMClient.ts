import type { LLMClient, LLMRequest } from './LLMClient.js';

/**
 * Claude CLI なしで開発・E2E確認するためのモック実装。
 * タスク種別ごとに妥当な形の日本語 JSON / テキストを返す。
 */
export class MockLLMClient implements LLMClient {
  readonly name = 'mock';

  async complete(req: LLMRequest): Promise<string> {
    switch (req.task) {
      case 'structure':
        return JSON.stringify({
          episodes: [
            {
              number: 1,
              title: '出会い',
              summary: '主人公が謎の少女と出会い、日常が動き出す。',
              scenes: [
                { title: '日常', summary: '主人公の平凡な朝。', characters: ['主人公'], foreshadowRefs: [] },
                {
                  title: '邂逅', summary: '路地裏で倒れている少女を発見する。',
                  characters: ['主人公', '少女'],
                  foreshadowRefs: [{ title: '少女のペンダント', action: 'setup' }],
                },
              ],
            },
            {
              number: 2,
              title: '追跡者',
              summary: '少女を追う組織の影が迫る。',
              scenes: [
                { title: '不穏', summary: '黒服の男たちが街に現れる。', characters: ['追跡者'], foreshadowRefs: [] },
                {
                  title: '逃走', summary: '二人は街を出る決意をする。',
                  characters: ['主人公', '少女'],
                  foreshadowRefs: [{ title: '少女のペンダント', action: 'payoff' }],
                },
              ],
            },
          ],
          foreshadowings: [
            {
              title: '少女のペンダント',
              description: '少女が肌身離さず持つペンダント。組織が狙う鍵。',
              setupEpisode: 1,
              plannedPayoffEpisode: 2,
              relatedCharacters: ['少女'],
              relatedItems: ['ペンダント'],
            },
          ],
        });

      case 'characters':
        return JSON.stringify({
          characters: [
            {
              name: '主人公',
              role: '主人公',
              appearance: '黒髪短髪の少年。制服姿。目つきは鋭いが表情は柔らかい。',
              personality: 'お人好しで巻き込まれ体質。芯は強い。',
            },
            {
              name: '少女',
              role: 'ヒロイン',
              appearance: '銀髪ロングの少女。白いワンピースと古びたペンダント。',
              personality: '無口だが好奇心旺盛。過去に秘密を抱える。',
            },
          ],
        });

      case 'panels':
        return JSON.stringify({
          panels: [
            {
              layout: { page: 1, x: 0, y: 0, w: 4, h: 2 },
              description: '朝の街並みの俯瞰。通学路を歩く主人公。',
              dialogues: [{ speaker: 'ナレーション', text: 'いつもと同じ朝のはずだった。', kind: 'narration', position: 'top-right' }],
              imagePrompt: 'manga panel, wide establishing shot of a japanese town in the morning, a boy walking to school',
              characters: ['主人公'],
              background: '通学路',
            },
            {
              layout: { page: 1, x: 0, y: 2, w: 2, h: 2 },
              description: '路地裏を覗き込む主人公のアップ。',
              dialogues: [{ speaker: '主人公', text: '…誰かいるのか?', kind: 'speech', position: 'top-right' }],
              imagePrompt: 'manga panel, close-up of a boy peering into a dark alley, surprised expression',
              characters: ['主人公'],
              background: '路地裏',
            },
            {
              layout: { page: 1, x: 2, y: 2, w: 2, h: 2 },
              description: '倒れている銀髪の少女。ペンダントが光る。',
              dialogues: [{ speaker: '主人公', text: 'おい、大丈夫か!?', kind: 'speech', position: 'top-left' }],
              imagePrompt: 'manga panel, a silver-haired girl collapsed in an alley, a glowing pendant on her chest',
              characters: ['主人公', '少女'],
              background: '路地裏',
            },
            {
              layout: { page: 1, x: 0, y: 4, w: 4, h: 2 },
              description: '少女が目を開く。瞳に主人公が映る。',
              dialogues: [
                { speaker: '少女', text: '…みつけた', kind: 'speech', position: 'top-right' },
                { speaker: '主人公', text: '(なんだ、この感覚…)', kind: 'thought', position: 'bottom-left' },
              ],
              imagePrompt: 'manga panel, extreme close-up of a girl opening her eyes, a boy reflected in her iris, dramatic',
              characters: ['主人公', '少女'],
            },
          ],
        });

      case 'name_critique': {
        const critic = req.system ?? '';
        if (critic.includes('読者')) {
          return '1ページ目の3コマ目、セリフ「おい、大丈夫か!?」の吹き出しが少女の顔に被りそうです。position を bottom-left に移すか、コマを縦に広げてください。ほかは読み順に迷いはありません。';
        }
        return 'P1-4 の大ゴマは良い見せ場ですが、直前の2コマが同サイズで単調です。P1-2 を横長の小ゴマにしてテンポを作り、P1-4 とのメリハリを強調してください。吹き出しの position 重複はありません。';
      }

      case 'discussion': {
        const role = req.system ?? '';
        if (role.includes('編集者')) {
          return '編集者として見ると、第1話の引きが弱いのが気になります。少女の正体を匂わせる一コマを最後に置き、ペンダントの伏線をより目立たせるべきです。';
        }
        if (role.includes('読者')) {
          return '読者目線では、主人公にもっと感情移入できる動機がほしいです。なぜ見知らぬ少女を助けるのか、過去のエピソードを一行でも示すと納得感が出ます。';
        }
        return 'プロット担当としては、2話での回収は早すぎる可能性があります。ペンダントの伏線は3〜4話まで引っ張り、代わりに小さな伏線（追跡者の紋章）を2話で回収する構成を提案します。';
      }

      case 'consensus':
        return JSON.stringify({
          summary: 'ペンダントの伏線回収を3話以降に延期し、第1話ラストに少女の正体を匂わせる引きゴマを追加。主人公の動機付けとして過去の描写を一行挿入する。',
          proposal:
            '1) 伏線「少女のペンダント」の回収予定を2話→3話に変更\n2) 第1話最終コマに少女の瞳が光る演出を追加\n3) 第1話冒頭に主人公が過去に誰かを助けられなかった描写を1コマ追加',
        });

      case 'apply_change':
        return JSON.stringify({
          applied: true,
          note: '変更指示を構成データに反映しました（モック）。',
        });

      case 'ref_image':
        return JSON.stringify({
          prompt:
            'character reference sheet, front view and side view, full body, ' +
            'a silver-haired girl in a white dress with an antique pendant, ' +
            'neutral gray background, consistent design, clean lineart',
        });

      case 'summarize':
      default:
        return 'これまでの決定事項: 構成・キャラ設定は生成済み。伏線は1件登録済み。（モック要約）';
    }
  }
}
