import { answers, type Answer } from './data'

/**
 * Routes a typed question to one of the grounded answers. There is no
 * language model behind the mock: a question matches when every word stem of
 * one of an answer's `match` entries appears in it. Anything else gets the
 * "no grounded answer" reply rather than a guess.
 */
export function matchQuestion(text: string): Answer | undefined {
  const q = text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ')
  const exact = answers.find((a) => a.question.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').trim() === q.trim())
  if (exact) return exact
  return answers.find((a) => a.match.some((words) => words.every((w) => q.includes(w))))
}
