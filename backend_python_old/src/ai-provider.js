function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text).length / 4));
}

export function createAiProvider({ apiKey = process.env.OPENAI_API_KEY, baseUrl = 'https://api.openai.com/v1' } = {}) {
  return {
    async generate({ model, prompt }) {
      if (!apiKey) {
        const text = `Demo output\n\n${prompt}\n\nThis run used the local deterministic provider. Add OPENAI_API_KEY to connect a live model.`;
        return {
          text,
          usage: { inputTokens: estimateTokens(prompt), outputTokens: estimateTokens(text) }
        };
      }

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'You are a precise content operations assistant.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.7
        }),
        signal: AbortSignal.timeout(30_000)
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`AI provider returned ${response.status}: ${detail.slice(0, 240)}`);
      }
      const data = await response.json();
      return {
        text: data.choices?.[0]?.message?.content ?? '',
        usage: {
          inputTokens: data.usage?.prompt_tokens ?? 0,
          outputTokens: data.usage?.completion_tokens ?? 0
        }
      };
    }
  };
}
