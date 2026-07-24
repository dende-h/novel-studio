import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PrivacyPage } from './privacy-page'
import { TermsPage } from './terms-page'
import { TokushohoPage } from './tokushoho-page'

describe('法務ページ（利用規約・プライバシーポリシー・特商法表記）', () => {
  it('利用規約：見出し・主要条文・戻る導線がある', () => {
    render(<TermsPage />)
    expect(screen.getByRole('heading', { name: '利用規約' })).toBeInTheDocument()
    // 作品の権利はユーザーに帰属する（本サービスの根幹の約束）
    expect(screen.getByRole('heading', { name: '第4条（作品データの権利）' })).toBeInTheDocument()
    expect(screen.getByText(/ユーザーに帰属します/)).toBeInTheDocument()
    // 失効時にアカウントとクラウドデータが削除される旨（webhook 実装との一致）
    expect(screen.getByText(/アカウントおよびクラウド上に保存された全データ/)).toBeInTheDocument()
    // 未成年者条項（課金サービスの必須条項）
    expect(screen.getByRole('heading', { name: '第3条（未成年者の利用）' })).toBeInTheDocument()
    // アプリへ戻る導線（ハッシュリンク）
    expect(screen.getByRole('link', { name: 'アプリへ戻る' })).toHaveAttribute('href', '#/')
  })

  it('プライバシーポリシー：ローカル保存の原則・MCPの自動送信・外部サービスの明記がある', () => {
    render(<PrivacyPage />)
    expect(screen.getByRole('heading', { name: 'プライバシーポリシー' })).toBeInTheDocument()
    // 無料利用では作品データを送信しない、という実装どおりの約束
    expect(
      screen.getByText(/作品データが運営者のサーバーへ送信されることはありません/),
    ).toBeInTheDocument()
    // MCP 有効時はライブスナップショットとして自動送信される事実の開示（複数箇所に登場）
    expect(screen.getAllByText(/ライブスナップショット/).length).toBeGreaterThanOrEqual(2)
    // 利用している外部サービスの列挙
    expect(
      screen.getByText(/Cloudflare（ホスティング・バックアップデータの保存）/),
    ).toBeInTheDocument()
    expect(screen.getByText(/Clerk（アカウント認証・課金管理）/)).toBeInTheDocument()
    expect(screen.getByText(/Stripe（決済処理）/)).toBeInTheDocument()
    // 失効時のアカウント・クラウドデータ削除
    expect(
      screen.getByText(/アカウントおよびクラウド上の全データは削除されます/),
    ).toBeInTheDocument()
  })

  it('特商法表記：解約・返金・支払方法の記載がある', () => {
    render(<TokushohoPage />)
    expect(screen.getByRole('heading', { name: '特定商取引法に基づく表記' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '解約について' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '返品・返金について' })).toBeInTheDocument()
    expect(screen.getByText(/クレジットカード決済（決済代行：Stripe）/)).toBeInTheDocument()
  })

  it('相互リンク（規約⇄ポリシー⇄特商法）をフッターに持つ', () => {
    render(<TermsPage />)
    expect(screen.getByRole('link', { name: 'プライバシーポリシー' })).toHaveAttribute(
      'href',
      '#/privacy',
    )
    expect(screen.getByRole('link', { name: '利用規約' })).toHaveAttribute('href', '#/terms')
    // 特商法へは本文（第2条・お問い合わせ）とフッターからリンクされる
    expect(
      screen.getAllByRole('link', { name: '特定商取引法に基づく表記' }).length,
    ).toBeGreaterThanOrEqual(1)
  })
})
