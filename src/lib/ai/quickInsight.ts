import { relevantPassages } from './document.ts';
import type { Passage } from './document.ts';

export type QuickMode = 'summary' | 'points' | 'ask';
export type QuickResult = { output: string; sourcePages: number[] };

const COMMON_WORDS = new Set('about after again also among and any are because been before between could each for from have into just many more most other over same should some such than that their them then there these they this those through very were what when where which while with would your document page'.split(' '));

function terms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter(word => !COMMON_WORDS.has(word));
}

type Sentence = { text: string; page: number; order: number; score: number };

function sentencesFrom(passages: Passage[]): Sentence[] {
  const result: Sentence[] = [];
  passages.forEach(passage => {
    const fragments = passage.text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [passage.text];
    fragments.forEach(fragment => {
      const text = fragment.replace(/\s+/g, ' ').trim().slice(0, 360);
      if (text.length >= 30 && terms(text).length >= 4) {
        result.push({ text, page: passage.page, order: result.length, score: 0 });
      }
    });
  });
  return result;
}

function bestSentences(passages: Passage[], limit: number, question = ''): Sentence[] {
  const candidates = sentencesFrom(passages);
  if (!candidates.length) return [];

  const frequency = new Map<string, number>();
  candidates.forEach(sentence => new Set(terms(sentence.text)).forEach(word => {
    frequency.set(word, (frequency.get(word) ?? 0) + 1);
  }));
  const query = new Set(terms(question));
  const relevant = candidates.map(sentence => {
    const words = new Set(terms(sentence.text));
    const topicality = [...words].reduce((total, word) => total + Math.min(frequency.get(word) ?? 0, 6), 0) / Math.sqrt(words.size + 1);
    const overlap = [...query].filter(word => words.has(word)).length;
    return { ...sentence, score: topicality + overlap * (question ? 100 : 0) };
  });
  const selected: Sentence[] = [];
  const unique = new Set<string>();
  for (const candidate of relevant.sort((a,b) => b.score - a.score || a.order - b.order)) {
    const fingerprint = terms(candidate.text).slice(0, 12).join(' ');
    if (unique.has(fingerprint)) continue;
    if (question && candidate.score < 100) continue;
    unique.add(fingerprint);
    selected.push(candidate);
    if (selected.length >= limit) break;
  }
  return selected.sort((a,b) => a.order - b.order);
}

/** Fast, offline EXTRACTIVE insights. These are not LLM-generated answers. */
export function quickInsight(passages: Passage[], mode: QuickMode, question = ''): QuickResult {
  if (mode === 'ask') {
    const matched = relevantPassages(passages, question, 3);
    const selected = bestSentences(matched, 3, question);
    if (!selected.length) {
      return { output: 'No matching answer was found in the extracted text. Try a more specific question or use the experimental AI model.', sourcePages: [] };
    }
    return {
      output: 'Relevant excerpts (not a generated answer):\n\n' +
        selected.map(sentence => 'Page ' + sentence.page + ': ' + sentence.text).join('\n\n'),
      sourcePages: [...new Set(selected.map(s => s.page))],
    };
  }

  const selected = bestSentences(passages, mode === 'points' ? 6 : 5);
  if (!selected.length) {
    return { output: 'Not enough readable sentences were found to extract useful highlights.', sourcePages: [] };
  }
  return {
    output: (mode === 'summary' ? 'Extractive summary · original document sentences:\n\n' : 'Key excerpts · original document sentences:\n\n') +
      selected.map(sentence => '• ' + sentence.text).join('\n\n'),
    sourcePages: [...new Set(selected.map(sentence => sentence.page))],
  };
}
