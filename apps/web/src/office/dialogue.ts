import type { ArchiveInfo, Character, Discussion, Episode, ForeshadowWarning, Project } from '@manga/shared';
import type { Npc } from './floors';

/**
 * NPC の «定型文»。作品の状態を見て、最初に話しかけたときの台詞を組み立てる。
 * LLM は使わない（即時に出る）。相談・要望は TalkWindow から LLM に渡す。
 */

export interface OfficeStatus {
  project: Project | null;
  episodes: Episode[];
  characters: Character[];
  backgrounds: { id: number; name: string; refImageUrl: string | null }[];
  warnings: ForeshadowWarning[];
  discussions: Discussion[];
  archive: ArchiveInfo | null;
  artStyleName: string | null;
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
      const lines = [`登場人物は ${cs.length} 人。`];
      lines.push(noRef.length
        ? `参照画像がないのは ${noRef.slice(0, 3).map((c) => c.name).join('・')}${noRef.length > 3 ? ' ほか' : ''}。ビジュアル工房で作れます。`
        : '全員に参照画像があります。作画のたびに私がチェックします。');
      return lines;
    }

    case 'location': {
      const bgs = s?.backgrounds ?? [];
      return bgs.length
        ? [`登録済みの場所は ${bgs.length} 件。${bgs.slice(0, 3).map((b) => b.name).join('・')}。`, '同じ名前の場所はネーム生成時にコマへ自動で割り当てられます。']
        : ['ロケハン担当です。まだ場所の登録がありません。', '何度も出てくる場所を登録しておくと、毎回同じ構造で描けます。'];
    }

    case 'artist': {
      if (!eps.length) return ['……話がまだないなら、描けないよ。', '2階の脚本家に構成を頼んできて。'];
      const target = eps.find((e) => e.status === 'paneled') ?? eps.find((e) => e.status === 'structured') ?? eps[eps.length - 1];
      const lines = ['よう。ネームと作画は任せろ。'];
      lines.push(`第${target.number}話「${target.title}」は${EP_STATUS[target.status] ?? target.status}。`);
      if (!s?.artStyleName) lines.push('画風がまだ決まってない。画材担当に相談してくれ。');
      else lines.push(`画風は「${s.artStyleName}」で描く。`);
      return lines;
    }

    case 'designer':
      return s?.artStyleName
        ? [`いまの画風は「${s.artStyleName}」。`, 'コマ割りのルールや構成テンプレートもここで変えられます。']
        : ['画材担当です。画風がまだ設定されていません。', 'モデルとスタイルプロンプトを決めると、全コマに反映されます。'];

    case 'meeting': {
      const pending = (s?.discussions ?? []).filter((d) => d.status === 'awaiting_user').length;
      const lines = ['会議室へようこそ。編集者・プロット担当・読者代表が議論します。'];
      if (pending) lines.push(`あなたの判断待ちの議題が ${pending} 件あります。`);
      lines.push('議題があれば「相談する」で投げてください。');
      return lines;
    }

    case 'manager': {
      const a = s?.archive;
      const done = a?.episodes.filter((e) => e.hasSummary).length ?? 0;
      const lines = ['書庫番です。これまでの話と設定はすべてここに。'];
      lines.push(a?.exists ? `要約済みは ${done} / ${a.episodes.length} 話。${a.notes ? '連載メモは最新です。' : '連載メモはまだありません。'}` : 'まだ書き出していません。部屋で「同期」を押してください。');
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
