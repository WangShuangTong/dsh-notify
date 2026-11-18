import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import type { PendingInteraction } from '../src/dsh.ts'
import {
  askCopy, doneCopy, errorCopy, languageOf, selfTestCopy, sessionTitleOf, truncateText,
} from '../src/client/messages.ts'

const approval: PendingInteraction = {
  key: 'a1',
  kind: 'approval',
  sessionId: 's1',
  toolName: 'pwsh',
  reason: 'outside workspace write',
  displayReason: { en: 'write outside the workspace', zh: '写入工作区之外' },
}

const question: PendingInteraction = {
  key: 'q1',
  kind: 'question',
  sessionId: 's1',
  questions: [{
    question: 'Which database should I use?',
    options: [{ label: 'Postgres' }, { label: 'SQLite' }],
  }, { question: 'Second question' }],
}

describe('languageOf', () => {
  it('maps Chinese tags to zh and everything else to en', () => {
    assert.equal(languageOf('zh-CN'), 'zh')
    assert.equal(languageOf('zh'), 'zh')
    assert.equal(languageOf('en-US'), 'en')
    assert.equal(languageOf(undefined), 'en')
  })
})

describe('sessionTitleOf', () => {
  it('prefers displayTitle, then title, then a short id', () => {
    assert.equal(sessionTitleOf({ displayTitle: 'Alpha', title: 'beta' }, 's1'), 'Alpha')
    assert.equal(sessionTitleOf({ title: 'beta' }, 's1'), 'beta')
    assert.equal(sessionTitleOf(undefined, 'abcdefghijklmnop'), 'abcdefgh…')
  })
})

describe('truncateText', () => {
  it('compacts whitespace and caps length', () => {
    assert.equal(truncateText('  a\n\n b  ', 20), 'a b')
    assert.equal(truncateText('abcdef', 4), 'abc…')
  })
})

describe('askCopy', () => {
  it('composes an approval notification with localized reason', () => {
    const zh = askCopy(approval, 'Alpha', 'zh')
    assert.match(zh.title, /批准/u)
    assert.match(zh.body, /会话：Alpha/u)
    assert.match(zh.body, /工具：pwsh/u)
    assert.match(zh.body, /写入工作区之外/u)
    assert.equal(zh.openLabel, '打开 DSH')

    const en = askCopy(approval, 'Alpha', 'en')
    assert.match(en.title, /Approval needed/u)
    assert.match(en.body, /Session: Alpha/u)
    assert.match(en.body, /write outside the workspace/u)
    assert.equal(en.openLabel, 'Open DSH')
  })

  it('composes a question with options and a remaining count', () => {
    const copy = askCopy(question, 'Alpha', 'en')
    assert.match(copy.title, /question is waiting/u)
    assert.match(copy.body, /Which database should I use\?/u)
    assert.match(copy.body, /Options: Postgres \/ SQLite/u)
    assert.match(copy.body, /1 more question/u)
    assert.ok(copy.body.includes('\n'))
  })

  it('labels a plan review distinctly', () => {
    const copy = askCopy({ key: 'p1', kind: 'plan-review', sessionId: 's1', questions: [{ question: 'Approve plan?' }] }, 'Alpha', 'en')
    assert.match(copy.title, /Plan awaiting review/u)
  })
})

describe('doneCopy', () => {
  it('reports one session with its title', () => {
    const copy = doneCopy(['Alpha'], 'en')
    assert.match(copy.title, /Turn complete/u)
    assert.match(copy.body, /Session: Alpha/u)
  })

  it('merges several sessions into one notification', () => {
    const copy = doneCopy(['Alpha', 'Beta'], 'zh')
    assert.match(copy.title, /2 个会话已完成/u)
    assert.match(copy.body, /Alpha、Beta/u)
  })
})

describe('errorCopy', () => {
  it('includes the failure message', () => {
    const copy = errorCopy('Alpha', 'provider returned 500', 'en')
    assert.match(copy.title, /Turn failed/u)
    assert.match(copy.body, /provider returned 500/u)
  })
})

describe('selfTestCopy', () => {
  it('is localized', () => {
    assert.match(selfTestCopy('zh').title, /通知已启用/u)
    assert.match(selfTestCopy('en').title, /Notifications are on/u)
  })
})
