// 推敲画面の解析辞書の zip の名前（COT-59）。scripts/build-dict.mjs・fetch-dict.mjs・gen-morph-fixtures.mjs が共有する。
// 名前を変えると配信 URL が変わり、端末の古い辞書のキャッシュは analyzer.worker.ts が消す。
// src/ui/proofread/protocol.ts の DICT_URL と analyzer.node.test.ts もこの名前にそろえる（テストで突き合わせる）。
export const DICT_FILE = 'lindera-ipadic-6.2.0-sudachi20260723.zip'
