import { describe, expect, test, vi } from 'vitest';
import { replyToInreach, InreachReplyError } from '../src/replyToInreach.js';

// Mirrors the real reply page: 3 inputs, deliberately varied attribute order.
const PAGE = `
<input name="MessageId" id="MessageId" value="577292428" />
<input id="ReplyAddress" value="flows@lateboof.com" />
<input value="08ded560-cd08-642e-7ced-8d79340a0000" name="Guid" id="Guid" />
`;

function mock(opts: { podUrl?: string; page?: string; post?: unknown; postStatus?: number }) {
  const podUrl = opts.podUrl ?? 'https://us0.explore.garmin.com/textmessage/txtmsg?extId=tok';
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('inreachlink.com')) {
      return { url: podUrl, ok: true, status: 200, text: async () => opts.page ?? PAGE } as unknown as Response;
    }
    return {
      url,
      ok: true,
      status: opts.postStatus ?? 200,
      json: async () => opts.post ?? { Success: true },
    } as unknown as Response;
  });
}

describe('replyToInreach', () => {
  test('scrapes the form and POSTs the reply to the resolved pod', async () => {
    const fetchFn = mock({});
    await replyToInreach('tok', 'GAULEY 2800 cfs', { fetchFn });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    const [postUrl, postInit] = fetchFn.mock.calls[1]!;
    expect(postUrl).toBe('https://us0.explore.garmin.com/TextMessage/TxtMsg');
    expect(postInit!.method).toBe('POST');
    const sent = new URLSearchParams(postInit!.body as string);
    expect(sent.get('MessageId')).toBe('577292428');
    expect(sent.get('Guid')).toBe('08ded560-cd08-642e-7ced-8d79340a0000');
    expect(sent.get('ReplyAddress')).toBe('flows@lateboof.com');
    expect(sent.get('ReplyMessage')).toBe('GAULEY 2800 cfs');
  });

  test('uses the geo pod from the redirect, not a hardcoded us0', async () => {
    const fetchFn = mock({ podUrl: 'https://eu0.explore.garmin.com/textmessage/txtmsg?extId=tok' });
    await replyToInreach('tok', 'hi', { fetchFn });
    expect(fetchFn.mock.calls[1]![0]).toBe('https://eu0.explore.garmin.com/TextMessage/TxtMsg');
  });

  test('throws when the reply form is missing its fields', async () => {
    const fetchFn = mock({ page: '<html>no form here</html>' });
    await expect(replyToInreach('tok', 'hi', { fetchFn })).rejects.toBeInstanceOf(InreachReplyError);
  });

  test('throws when Garmin does not return Success:true', async () => {
    const fetchFn = mock({ post: { Success: false } });
    await expect(replyToInreach('tok', 'hi', { fetchFn })).rejects.toBeInstanceOf(InreachReplyError);
  });

  test('throws on a non-JSON / error response from the POST', async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('inreachlink.com')) {
        return { url: 'https://us0.explore.garmin.com/x?extId=tok', ok: true, status: 200, text: async () => PAGE } as unknown as Response;
      }
      return { url, ok: false, status: 500, json: async () => { throw new Error('not json'); } } as unknown as Response;
    });
    await expect(replyToInreach('tok', 'hi', { fetchFn })).rejects.toBeInstanceOf(InreachReplyError);
  });
});
