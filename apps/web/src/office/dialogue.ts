import type { ArchiveInfo, Character, DesignProposal, Discussion, Episode, ForeshadowWarning, ImageModelCaps, Project } from '@manga/shared';
import type { Npc } from './floors';

/**
 * NPC の «定型文»。作品の状態を見て、最初に話しかけたときの台詞を組み立てる。
 * LLM は使わない（即時に出る）。相談・要望は TalkWindow から LLM に渡す。
 */

export interface OfficeStatus {
  project: Project | null;
  episodes: Episode[];
  characters: Character[];
  backgrounds: { id: number; name: string; description: string; refImageUrl: string | null }[];
  warnings: ForeshadowWarning[];
  discussions: Discussion[];
  archive: ArchiveInfo | null;
  artStyleName: string | null;
  /** 設定画の提案（キャラ） */
  design: DesignProposal[] | null;
  /** 設定画の提案（背景） */
  designBg: DesignProposal[] | null;
  /** 適用中の画風のモデルが設定画をどう受け取るか */
  imageCaps: ImageModelCaps | null;
}

const EP_STATUS: Record<string, string> = {
  draft: '下書き', structured: '構成済み', paneled: 'ネーム済み', rendered: '作画済み',
};

export function npcLines(npc: Npc, s: OfficeStatus | null): string[] {
  const p = s?.project ?? null;
  const eps = s?.episodes ?? [];
  const title = p ? `「${p.title}」` : '';

  if (!p && !npc.global) {
    return ['……まだ担当作品が決まっていませんね。', '1階の受付で作品を選んでから、もう一度声をかけてください。'];
  }

  switch (npc.id) {
    case 'reception':
      return p
        ? [`いらっしゃいませ。ただいまの担当作品は${title}です。`, '別の作品に切り替える・新しい連載を立ち上げるなら、作品一覧をどうぞ。']
        : ['ようこそ、編集部ビルへ。', 'まずは担当作品を決めましょう。作品一覧から選ぶか、新しい連載を立ち上げてください。'];

    case 'assets':
      return ['ここは作品をまたいで使えるアセットの倉庫だ。', 'キャラ・画風・世界観を保存しておけば、別の連載にもキャスティングできる。'];

    case 'chief': {
      const lines = [`おう、来たか。${title}の進み具合を話そう。`];
      if (!eps.length) lines.push('まだ話数構成がない。2階の脚本家に構成を頼んでくれ。');
      else {
        const paneled = eps.filter((e) => e.status === 'paneled' || e.status === 'rendered').length;
        const rendered = eps.filter((e) => e.status === 'rendered').length;
        lines.push(`構成は第${eps.length}話まで。ネーム済み ${paneled} 話、作画済み ${rendered} 話だ。`);
      }
      if (!s?.characters.length) lines.push('キャラクター設定がまだだ。資料室の設定担当に頼め。');
      else {
        const noRef = s.characters.filter((c) => !c.refImageUrl && !c.loraUrl).length;
        if (noRef > 0) lines.push(`参照画像のないキャラが ${noRef} 人いる。顔がブレるぞ。`);
      }
      const w = s?.warnings.length ?? 0;
      if (w > 0) lines.push(`伏線の未回収が ${w} 件。地下の進行担当が気にしている。`);
      lines.push('細かい指示があれば「相談する」で言ってくれ。構成に反映させる。');
      return lines;
    }

    case 'writer': {
      if (!eps.length) return ['脚本家です。あらすじは読みました。', '話数構成はまだ作っていません。部屋に入って「構成を生成」を押してください。'];
      const next = eps.find((e) => e.status === 'structured' || e.status === 'draft');
      const lines = [`第${eps.length}話まで構成を書きました。`];
      if (next) lines.push(`第${next.number}話「${next.title}」はまだネーム前です。シーン構成を確認してから3階へ回してください。`);
      else lines.push('全話ネームまで進んでいます。続きの構成を書きましょうか。');
      return lines;
    }

    case 'chara': {
      const cs = s?.characters ?? [];
      if (!cs.length) return ['資料室です。まだキャラクターの設定がありません。', '構成があれば、そこから自動で配役を起こせます。'];
      const noRef = cs.filter((c) => !c.refImageUrl && !c.loraUrl);
      const pending = (s?.design ?? []).filter((d) => !d.adopted && d.top).length;
      const lines = [`登場人物は ${cs.length} 人。`];
      if (pending) lines.push(`設定画の候補が ${pending} 人分できています。私のおすすめを選んであります。`);
      else if (noRef.length) lines.push(`設定画がないのは ${noRef.slice(0, 3).map((c) => c.name).join('・')}${noRef.length > 3 ? ' ほか' : ''}。頼んでもらえれば候補を描いて選びます。`);
      else lines.push('全員の設定画が揃っています。作画のたびに私がチェックします。');
      return lines;
    }

    case 'location': {
      const bgs = s?.backgrounds ?? [];
      const pending = (s?.designBg ?? []).filter((d) => !d.adopted && d.top).length;
      const noRef = bgs.filter((b) => !b.refImageUrl).length;
      if (!bgs.length) return ['ロケハン担当です。まだ場所の登録がありません。', '構成とネームから、繰り返し出てくる場所を拾い出せます。'];
      const lines = [`登録済みの場所は ${bgs.length} 件。${bgs.slice(0, 3).map((b) => b.name).join('・')}${bgs.length > 3 ? ' ほか' : ''}。`];
      if (pending) lines.push(`背景の設定画の候補が ${pending} 件できています。おすすめを選んであります。`);
      else if (noRef) lines.push(`設定画がない場所が ${noRef} 件。頼んでもらえれば候補を描いて選びます。自分で撮った写真があれば、そこから起こすこともできます。`);
      else lines.push('全部の場所に設定画があります。同じ名前の場所はネーム生成時にコマへ自動で割り当てられます。');
      return lines;
    }

    case 'artist': {
      if (!eps.length) return ['……話がまだないなら、描けないよ。', '2階の脚本家に構成を頼んできて。'];
      const target = eps.find((e) => e.status === 'paneled') ?? eps.find((e) => e.status === 'structured') ?? eps[eps.length - 1];
      const lines = ['よう。ネームと作画は任せろ。'];
      lines.push(`第${target.number}話「${target.title}」は${EP_STATUS[target.status] ?? target.status}。`);
      if (!s?.artStyleName) lines.push('画風がまだ決まってない。画材担当に相談してくれ。');
      else lines.push(`画風は「${s.artStyleName}」で描く。`);
      if (s?.imageCaps && s.imageCaps.refMode === 'none') lines.push('ただ、いまのモデルだと設定画を見ながら描けない。画材担当にモデルを替えてもらってくれ。');
      return lines;
    }

    case 'designer': {
      if (!s?.artStyleName) return ['画材担当です。画風がまだ設定されていません。', 'モデルとスタイルプロンプトを決めると、全コマに反映されます。'];
      const lines = [`いまの画風は「${s.artStyleName}」。`];
      const c = s.imageCaps;
      if (c?.refMode === 'multi') lines.push(`モデルは ${c.label}。設定画を最大 ${c.maxRefs} 枚まで作画に渡せます。キャラと背景の一貫性はこれで保ちます。`);
      else if (c?.refMode === 'single') lines.push(`モデルは ${c.label}。参照画像は1枚しか渡せないので、主役の顔だけ守れます。背景まで揃えるなら nano-banana などに替えてください。`);
      else if (c) lines.push(`注意: モデル ${c.label} は設定画を受け取れません。固定文と作画チェックだけでは顔がブレます。画風のモデルを google/nano-banana などに替えてください。`);
      lines.push('コマ割りのルールや構成テンプレートもここで変えられます。');
      return lines;
    }

    case 'meeting': {
      const ds = s?.discussions ?? [];
      const pending = ds.filter((d) => d.status === 'awaiting_user').length;
      const running = ds.find((d) => d.status === 'running');
      const lines = ['会議室へようこそ。議題を出せば、編集者・プロット担当・読者代表がこの場で議論します。'];
      if (running) lines.push(`いま「${running.topic}」を議論中です。席について聞けます。`);
      if (pending) lines.push(`あなたの判断待ちの議題が ${pending} 件あります。`);
      return lines;
    }
    case 'editor':
      return ['編集者だ。議題は司会に出してくれ。', '俺は売れるか、引きが強いかで判断する。'];
    case 'plotter':
      return ['プロット担当です。', '伏線の整合性と構成の流れを見ています。議題は司会へ。'];
    case 'reader':
      return ['読者代表です！', '面白いかどうか、読者の目で正直に言います。議題は司会さんに。'];

    case 'manager': {
      const a = s?.archive;
      const done = a?.episodes.filter((e) => e.hasSummary).length ?? 0;
      const lines = ['書庫番です。これまでの話と設定はすべてここに。'];
      lines.push(a?.exists ? `要約済みは ${done} / ${a.episodes.length} 話。${a.notes ? '連載メモは最新です。' : '連載メモはまだありません。'}` : 'まだ書き出していません。部屋で「同期」を押してください。');
      const decided = (s?.discussions ?? []).filter((d) => (d.status === 'adopted' || d.status === 'rejected') && !/ネーム批評（自動）$/.test(d.topic)).length;
      if (decided) lines.push(`会議の決定事項は ${decided} 件、バイブルに残してあります。`);
      lines.push('過去の設定について聞きたければ「相談する」でどうぞ。');
      return lines;
    }

    case 'foreshadow': {
      const w = s?.warnings ?? [];
      return w.length
        ? [`進行担当です。回収が遅れている伏線が ${w.length} 件。`, w[0].message]
        : ['進行担当です。伏線の回収は今のところ順調です。'];
    }
  }
  return [`${npc.name}です。${npc.hint}。`];
}
