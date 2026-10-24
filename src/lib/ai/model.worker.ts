/** Isolated AI inference: model is downloaded once by the browser and run locally. */
type Job = { id: number; kind: 'summary' | 'points' | 'ask'; contexts: string[]; question?: string };
type Generator = (prompt: string, maxTokens: number) => Promise<string>;
let generator: Promise<Generator> | null = null;
const send = (data: object) => self.postMessage(data);

async function getGenerator(): Promise<Generator> {
  if (generator) return generator;
  generator = (async () => {
    send({ type: 'status', message: 'Downloading the local AI model (first run may use 100+ MB)…' });
    const { pipeline, env } = await import('@huggingface/transformers');
    env.allowLocalModels = false;
    const model = await pipeline('text2text-generation', 'Xenova/flan-t5-small', {
      device: 'wasm',
      dtype: 'q8',
      progress_callback: (event: { status?: string; progress?: number }) => {
        if (event.status === 'progress' && typeof event.progress === 'number') {
          send({ type: 'status', message: `Downloading model… ${Math.round(event.progress)}%` });
        }
      },
    });
    send({ type: 'status', message: 'AI model ready. Generating your result…' });
    return async (prompt: string, maxTokens: number) => {
      const result = await model(prompt, { max_new_tokens: maxTokens, do_sample: false });
      const item: unknown = Array.isArray(result) ? result[0] : result;
      return item && typeof item === 'object' && 'generated_text' in item ? String(item.generated_text).trim() : '';
    };
  })().catch(error => { generator = null; throw error; });
  return generator;
}

self.onmessage = async (event: MessageEvent<Job>) => {
  const { id, kind, contexts, question } = event.data;
  try {
    const generate = await getGenerator();
    let output = '';
    if (kind === 'summary') {
      const partials: string[] = [];
      for (let i = 0; i < contexts.length; i++) {
        send({ type: 'status', message: `Summarizing excerpt ${i + 1} of ${contexts.length}…` });
        partials.push(await generate(`Summarize the following document excerpt in clear English: ${contexts[i]}`, 100));
      }
      output = partials.length > 1
        ? await generate(`Write a concise overall summary based on these notes: ${partials.join(' ')}`.slice(0, 1900), 165)
        : partials[0];
    } else if (kind === 'points') {
      const notes: string[] = [];
      for (let i = 0; i < contexts.length; i++) {
        send({ type: 'status', message: `Extracting key points ${i + 1} of ${contexts.length}…` });
        notes.push(await generate(`What is the most important fact in this passage? ${contexts[i]}`, 70));
      }
      output = [...new Set(notes.map(s => s.trim()).filter(Boolean))].map(s => `• ${s}`).join('\n');
    } else {
      output = await generate(`Answer this question ONLY using the context. If there is no answer, say "Not found in document". Question: ${question || ''} Context: ${contexts.join(' ').slice(0, 1500)}`, 130);
    }
    if (!output) throw new Error('The model returned an empty response. Try a shorter document.');
    send({ type: 'result', id, output });
  } catch (error) {
    send({ type: 'error', id, error: error instanceof Error ? error.message : 'AI processing failed.' });
  }
};
