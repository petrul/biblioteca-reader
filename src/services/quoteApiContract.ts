const quoteGetContract = {
  get: {
    summary: 'Resolve a TEI quotation using server fragment boundaries',
    parameters: ['path', 'start', 'end'].map(name => ({ name, in: 'query', required: true, schema: { type: 'string' } })),
    responses: {
      '200': { description: 'Quotation and source attribution', content: { 'application/json': { schema: {
        type: 'object', required: ['text', 'paragraphs', 'workId', 'chapterId', 'workTitle', 'chapterTitle', 'authorName', 'canonicalUrl'],
        properties: {
          language: { type: 'string' }, text: { type: 'string' }, paragraphs: { type: 'array', items: { type: 'string' } },
          workId: { type: 'string' }, chapterId: { type: 'string' }, workTitle: { type: 'string' },
          chapterTitle: { type: 'string' }, authorName: { type: 'string' }, canonicalUrl: { type: 'string' }
        }
      } } } },
      '400': { description: 'Invalid source boundaries' }, '403': { description: 'Outside free preview' },
      '404': { description: 'Quotation not found' }, '502': { description: 'Source unavailable' }
    }
  }
};

export const quoteApiContract = { ...quoteGetContract, post: {
  summary: 'Resolve a selected passage into exact TEI fragment boundaries',
  requestBody: { required: true, content: { 'application/json': { schema: {
    type: 'object', required: ['path', 'text'], properties: {
      path: { type: 'string' }, text: { type: 'string', maxLength: 30000 },
      context: { type: 'string' }, before: { type: 'string' }
    }
  } } } },
  responses: { ...quoteGetContract.get.responses, '409': { description: 'Ambiguous source passage' }, '422': { description: 'Selection not found in source' } }
} };
