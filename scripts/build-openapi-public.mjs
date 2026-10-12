import { writeFile } from 'node:fs/promises';

// Builds openapi-public.json: this app's real public API contract, for
// both the Swagger UI at /api/docs AND the typed client
// (serversideApi.ts, via openapi:sync + openapi:generate) - see
// biblioteca-server/README.md's "Public vs internal REST endpoints" for
// why biblioteca-server's/nestjs's raw specs are never used directly.
//
// The biblioteca-server-backed entries are pulled from its REAL spec, not
// hand-typed: BIBLIOTECA_PATHS below is the actual, explicit, reviewed
// allowlist (adding a route this app needs means adding a line here),
// but their parameter/response SHAPES come straight from biblioteca-server
// so the generated TypeScript client stays accurate - hand-typing DTOs by
// hand drifts the moment biblioteca-server's own shape changes, silently.
// Failing loudly here (an allowlisted path/method disappearing upstream)
// is the point, not a bug to work around. Public path === upstream path,
// verbatim: server.ts's /api/** gateway needs no prefix translation.
const BIBLIOTECA_SERVER_URL = (process.env.BIBLIOTECA_SERVER_URL || 'http://localhost:8080').replace(/\/$/, '');

const BIBLIOTECA_PATHS = {
    '/api/users/me': ['get'],
    '/api/lucene/status': ['get'],
    '/api/reading-progress': ['get', 'put'],
    '/api/reading-progress/one': ['get'],
    '/api/reading-progress/attention': ['put'],
    '/api/reading-progress/scroll': ['put'],
    '/api/users/me/preferences': ['get', 'put'],
    '/api/divs': ['get'],
    '/api/divs/{id}/toc': ['get'],
    '/api/authors/': ['get'],
    '/api/authors/page': ['get'],
    '/api/authors/{strId}': ['get'],
    '/api/works': ['get'],
    '/api/collections/system/repos': ['get'],
    '/api/collections/system/featured': ['get'],
    '/api/drest/teiDivs/search/findOpera': ['get'],
    '/api/search/authors': ['get'],
    '/api/search/divHeads': ['get'],
    '/api/search/grep': ['get'],
    '/api/search/lucene': ['get'],
    '/api/search/vector': ['get'],
    '/api/util/random': { upstream: '/util/random', methods: ['get'] },
};

const upstreamRes = await fetch(`${BIBLIOTECA_SERVER_URL}/api/docs`, { headers: { Accept: 'application/json' } });
if (!upstreamRes.ok) {
    throw new Error(`Could not reach biblioteca-server's own OpenAPI doc at ${BIBLIOTECA_SERVER_URL}/api/docs: HTTP ${upstreamRes.status}`);
}
const upstream = await upstreamRes.json();

const biblioPaths = {};
for (const [publicPath, entry] of Object.entries(BIBLIOTECA_PATHS)) {
    const upstreamPath = Array.isArray(entry) ? publicPath : entry.upstream;
    const methods = Array.isArray(entry) ? entry : entry.methods;
    const upstreamOp = upstream.paths?.[upstreamPath];
    if (!upstreamOp) {
        throw new Error(`biblioteca-server no longer serves ${upstreamPath} - update BIBLIOTECA_PATHS in this script (and server.ts's BIBLIOTECA_GET_ROUTES/etc.)`);
    }
    const filtered = {};
    for (const method of methods) {
        if (!upstreamOp[method]) {
            throw new Error(`biblioteca-server's ${upstreamPath} has no ${method} - update BIBLIOTECA_PATHS in this script`);
        }
        filtered[method] = upstreamOp[method];
    }
    biblioPaths[publicPath] = filtered;
}

// Hand-typed: not a biblioteca-server passthrough at all - server.ts
// bridges Google One Tap's credential exchange and Spring Security's
// default /logout into these two plain JSON contracts itself (see the
// comments on those two routes there).
const authPaths = {
    '/api/auth/google': {
        post: {
            summary: 'Google One Tap sign-in (bridges to biblioteca-server session auth)',
            requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['credential'], properties: { credential: { type: 'string' } } } } } },
            responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, error: { type: 'string' } } } } } } },
        },
    },
    '/api/auth/logout': {
        post: {
            summary: 'Sign out (invalidates the biblioteca-server session)',
            responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' } } } } } } },
        },
    },
};

const contentPath = {
    '/api/server-content/{authorAndOpusPath}': {
        get: {
            summary: 'Raw content passthrough (the public reading surface itself - HTML/text/TEI/JSON by suffix, see biblioteca-server\'s own README). Not a structured API call: this is the one deliberately broad content route.',
            parameters: [{ name: 'authorAndOpusPath', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '200': { description: 'OK' } },
        },
    },
};

// This app's own, not proxied anywhere. Hand-typed like authPaths above,
// for the same reason: server.ts implements these handlers itself (Stripe
// or the sandbox simulator), so these schemas document that
// implementation - the request/response shapes the reader's client
// (readerService's payment flow, via serversideApi.ts) is typed against.
const ownPaths = {
    '/api/covers/work': {
        post: {
            summary: 'Render a randomized cover for a canonical work through the same-origin gateway',
            requestBody: { required: true, content: { 'application/json': { schema: {
                type: 'object', required: ['title', 'author'], properties: {
                    workId: { type: 'string', description: 'Canonical authorId/opusId path' },
                    title: { type: 'string' }, author: { type: 'string' }, subtitle: { type: 'string' },
                    date: { type: 'string' }, coverArtUrl: { type: 'string', format: 'uri' },
                },
            } } } },
            responses: {
                '200': { description: 'Rendered PNG cover', content: { 'image/png': { schema: { type: 'string', format: 'binary' } } } },
                '400': { description: 'Missing or malformed work metadata' },
                '502': { description: 'Cover renderer unavailable or timed out' },
            },
        },
    },
    '/api/payment/config': {
        get: {
            summary: 'Payment provider config/capabilities (Stripe, unconfigured by default)',
            responses: {
                '200': {
                    description: 'OK',
                    content: { 'application/json': { schema: {
                        type: 'object',
                        required: ['status', 'provider', 'isLiveConfigured', 'publishableKey', 'supportedCurrencies', 'acceptedMethods', 'mode'],
                        properties: {
                            status: { type: 'string' },
                            provider: { type: 'string', enum: ['stripe'] },
                            isLiveConfigured: { type: 'boolean' },
                            publishableKey: { type: 'string' },
                            supportedCurrencies: { type: 'array', items: { type: 'string' } },
                            acceptedMethods: { type: 'array', items: { type: 'string' } },
                            mode: { type: 'string', enum: ['live', 'sandbox'] },
                        },
                    } } },
                },
            },
        },
    },
    '/api/payment/create-intent': {
        post: {
            summary: 'Create a Stripe payment intent (or sandbox equivalent) for a work',
            requestBody: { content: { 'application/json': { schema: {
                type: 'object',
                required: ['workId', 'amountCents'],
                properties: {
                    workId: { type: 'string' },
                    workTitle: { type: 'string' },
                    amountCents: { type: 'integer' },
                    currency: { type: 'string' },
                    userEmail: { type: 'string' },
                    userId: { type: 'string' },
                },
            } } } },
            responses: {
                '200': {
                    description: 'OK (Stripe live or sandbox simulator)',
                    content: { 'application/json': { schema: {
                        type: 'object',
                        required: ['success', 'clientSecret', 'paymentId', 'amountCents', 'currency', 'status', 'mode'],
                        properties: {
                            success: { type: 'boolean' },
                            clientSecret: { type: 'string' },
                            paymentId: { type: 'string' },
                            amountCents: { type: 'integer' },
                            currency: { type: 'string' },
                            status: { type: 'string' },
                            mode: { type: 'string' },
                            // Sandbox responses only - not emitted when Stripe is live.
                            note: { type: 'string' },
                        },
                    } } },
                },
                '400': { description: 'Missing workId/amountCents', content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } } } } } },
                '500': { description: 'Payment intent creation failed', content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } } } } } },
            },
        },
    },
    '/api/payment/confirm': {
        post: {
            summary: 'Confirm/verify a payment and record the purchase',
            requestBody: { content: { 'application/json': { schema: {
                type: 'object',
                required: ['paymentId', 'workId'],
                properties: {
                    paymentId: { type: 'string' },
                    workId: { type: 'string' },
                    workTitle: { type: 'string' },
                    amountCents: { type: 'integer' },
                    currency: { type: 'string' },
                    userId: { type: 'string' },
                    customerEmail: { type: 'string' },
                },
            } } } },
            responses: {
                '200': {
                    description: 'OK',
                    content: { 'application/json': { schema: {
                        type: 'object',
                        required: ['success', 'receipt'],
                        properties: {
                            success: { type: 'boolean' },
                            receipt: {
                                type: 'object',
                                required: ['orderId', 'paymentId', 'workId', 'workTitle', 'amountPaid', 'status', 'accessGranted', 'unlockedAt', 'teiAccessTier'],
                                properties: {
                                    orderId: { type: 'string' },
                                    paymentId: { type: 'string' },
                                    workId: { type: 'string' },
                                    workTitle: { type: 'string' },
                                    amountPaid: { type: 'string' },
                                    status: { type: 'string' },
                                    accessGranted: { type: 'boolean' },
                                    unlockedAt: { type: 'string' },
                                    teiAccessTier: { type: 'string' },
                                },
                            },
                        },
                    } } },
                },
                '400': { description: 'Missing paymentId/workId', content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } } } } } },
                '402': { description: 'Payment not verified / still processing', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, error: { type: 'string' } } } } } },
                '500': { description: 'Payment confirmation failed', content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } } } } } },
            },
        },
    },
    '/api/payment/purchases/{userId}': {
        get: { summary: "A user's verified purchases", parameters: [{ name: 'userId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
    },
    '/api/health': { get: { summary: 'This server\'s own health', responses: { '200': { description: 'OK' } } } },
    '/api/info': { get: { summary: 'This server\'s own name/version', responses: { '200': { description: 'OK' } } } },
};

// Hand-typed: nestjs's own doc isn't sourced here (its response shape is
// small and stable - VectorizingStatus - and this relay already
// constrains :action to start|pause|resume at the route level, see
// server.ts).
const vzPaths = {
    '/api/vectorizing': {
        get: {
            summary: 'nestjs vectorizing job status (admin page indexing card)',
            responses: {
                '200': {
                    description: 'OK', content: { 'application/json': { schema: {
                        type: 'object',
                        properties: {
                            running: { type: 'boolean' }, state: { type: 'string' },
                            totalOpera: { type: 'integer', nullable: true }, completedOpera: { type: 'integer' },
                            processedParas: { type: 'integer' }, pauseRequested: { type: 'boolean' }, canResume: { type: 'boolean' },
                        },
                    } } },
                },
            },
        },
    },
    '/api/vectorizing/{action}': {
        post: {
            summary: 'nestjs vectorizing control: start/pause/resume (fire-and-forget)',
            parameters: [{ name: 'action', in: 'path', required: true, schema: { type: 'string', enum: ['start', 'pause', 'resume'] } }],
            responses: { '202': { description: 'Accepted', content: { 'application/json': { schema: { type: 'object', properties: { accepted: { type: 'boolean' } } } } } } },
        },
    },
};

const doc = {
    openapi: '3.0.3',
    info: {
        title: 'Biblioteca Reader - public API',
        version: '1.0.0',
        description:
            'Everything a browser may call on this origin. biblioteca-server and ' +
            'biblioteca-nestjs are never reachable from the internet directly - ' +
            'this reader backend is the only bridge, and every /api/** route ' +
            'below (bar the raw /api/server-content/* content passthrough) is an explicit, ' +
            'individually-registered proxy (see server.ts), never a wildcard ' +
            'forward, and shared by both upstreams (no prefix distinguishes ' +
            'which one a given path actually goes to - that is server.ts\'s ' +
            'business, not this contract\'s). The biblioteca-server-backed ' +
            'entries\' shapes are pulled live from its own spec by this file\'s ' +
            'generator (scripts/build-openapi-public.mjs) - only their ' +
            'EXISTENCE here, not their shape, is hand-curated.',
    },
    components: { schemas: upstream.components?.schemas ?? {} },
    paths: { ...biblioPaths, ...authPaths, ...contentPath, ...ownPaths, ...vzPaths },
};

await writeFile(new URL('../openapi-public.json', import.meta.url), JSON.stringify(doc, null, 2));
console.log(`Wrote openapi-public.json: ${Object.keys(doc.paths).length} paths, ${Object.keys(doc.components.schemas).length} schemas, sourced from ${BIBLIOTECA_SERVER_URL}`);
