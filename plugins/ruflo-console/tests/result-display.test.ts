import { describe, expect, mock, test } from 'claude-code/testing'

import { RUFLO_FILES } from './fixtures/ruflo-run'
import { cliAnswer, command, elementsOf, paneAt, PLUGIN, SESSION, textOf, worldOf } from './fixtures/world'

/** The pasted `neural patterns` answer: the CLI's ASCII table, as the CLI prints it. */
const TABLE = [
  'Neural Patterns - list',
  '+--------------------+--------+------------+-------+',
  '| ID                 | Type   | Confidence | Usage |',
  '+--------------------+--------+------------+-------+',
  '| pattern-1783881957 | action | 100.0%     | 524   |',
  '| pattern-1785100193 | result | 100.0%     | 385   |',
  '+--------------------+--------+------------+-------+',
  '',
  '**2 patterns** shown, see `neural train`',
].join('\n')

describe('result display in the real engine', () => {
  test('a result is one coloured frame, its CLI table is drawn with aligned columns, and markdown is read as text', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)

    world.respond = argv => (argv.includes('analyze_diff-stats') ? { exitCode: 0, stdout: TABLE, stderr: '' } : cliAnswer(argv))
    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command('devtools'))

    const pane = await $.ui.mount({ ...paneAt(110), plugin: PLUGIN })

    await pane.press({ key: 'dt-diff-stats' })

    const tree = await pane.drawn()
    const text = textOf(tree)


    // The table is read back as cells and drawn with box characters, every row the same width.
    expect(text).toContain('┌────────────────────┬────────┬────────────┬───────┐')
    expect(text).toContain('│ ID                 │ Type   │ Confidence │ Usage │')
    expect(text).toContain('│ pattern-1783881957 │ action │ 100.0%     │ 524   │')
    expect(text).not.toContain('| ID | Type |')
    expect(text).not.toContain('+-------')
    // Markdown markers are gone from the sentence under it.
    expect(text).toContain('2 patterns shown, see neural train')
    expect(text).not.toContain('**2 patterns**')
    // And the result sits in one rounded frame, green because the run passed (the text surface does not draw borders, so the tree is checked).
    const frames = elementsOf(tree, 'Box').filter(box => (box as unknown as { props: { key?: string } }).props.key === 'result-frame')

    expect(frames).toHaveLength(1)
    expect((frames[0] as unknown as { props: object } | undefined)?.props).toMatchObject({ borderStyle: 'round', borderColor: expect.stringMatching(/.+/) })
  })
})
