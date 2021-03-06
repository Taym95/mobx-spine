import { get } from 'lodash';
import axios from 'axios';

// Function ripped from Django docs.
// See: https://docs.djangoproject.com/en/dev/ref/csrf/#ajax
function csrfSafeMethod(method) {
    // These HTTP methods do not require CSRF protection.
    return /^(GET|HEAD|OPTIONS|TRACE)$/i.test(method);
}

export default class BinderApi {
    baseUrl = null;
    csrfToken = null;
    defaultHeaders = {};
    axios = axios.create();

    constructor() {
        this.__initializeCsrfHandling();
    }

    __initializeCsrfHandling() {
        this.axios.interceptors.response.use(null, err => {
            const status = get(err, 'response.status');
            const statusErrCode = get(err, 'response.data.code');
            const doNotRetry = get(err, 'response.config.doNotRetry');
            if (
                status === 403 &&
                statusErrCode === 'CSRFFailure' &&
                !doNotRetry
            ) {
                return this.fetchCsrfToken().then(() =>
                    this.axios({
                        ...err.response.config,
                        doNotRetry: true,
                    })
                );
            }
            return Promise.reject(err);
        });
    }

    __request(method, url, data, options) {
        options || (options = {});
        const useCsrfToken = csrfSafeMethod(method)
            ? undefined
            : this.csrfToken;
        this.__testUrl(url);

        const axiosOptions = {
            method,
            baseURL: this.baseUrl,
            url,
            data: method !== 'get' && data ? data : undefined,
            params: method === 'get' && data ? data : options.params,
        };

        Object.assign(axiosOptions, options);

        // Don't clear existing headers when adding `options.headers`
        const headers = Object.assign(
            {
                'Content-Type': 'application/json',
                'X-Csrftoken': useCsrfToken,
            },
            this.defaultHeaders,
            options.headers
        );
        axiosOptions.headers = headers;

        const xhr = this.axios(axiosOptions);

        // We fork the promise tree as we want to have the error traverse to the listeners
        if (this.onRequestError && options.skipRequestError !== true) {
            xhr.catch(this.onRequestError);
        }

        const onSuccess =
            options.skipFormatter === true
                ? Promise.resolve()
                : this.__responseFormatter;
        return xhr.then(onSuccess);
    }

    parseBackendValidationErrors(response) {
        const valErrors = get(response, 'data.errors');
        if (response.status === 400 && valErrors) {
            return valErrors;
        }
        return null;
    }

    fetchCsrfToken() {
        return this.get('/api/bootstrap/').then(res => {
            this.csrfToken = res.csrf_token;
        });
    }

    __responseFormatter(res) {
        return res.data;
    }

    __testUrl(url) {
        if (!url.endsWith('/')) {
            throw new Error(
                `Binder does not accept urls that do not have a trailing slash: ${url}`
            );
        }
    }

    get(url, data, options) {
        return this.__request('get', url, data, options);
    }

    post(url, data, options) {
        return this.__request('post', url, data, options);
    }

    patch(url, data, options) {
        return this.__request('patch', url, data, options);
    }

    put(url, data, options) {
        return this.__request('put', url, data, options);
    }

    delete(url, data, options) {
        return this.__request('delete', url, data, options);
    }

    buildFetchModelParams(model) {
        return {
            // TODO: I really dislike that this is comma separated and not an array.
            // We should fix this in the Binder API.
            with:
                model.__activeRelations
                    .map(model.constructor.toBackendAttrKey)
                    .join(',') || null,
        };
    }

    fetchModel({ url, data, requestOptions }) {
        return this.get(url, data, requestOptions).then(res => {
            return {
                data: res.data,
                repos: res.with,
                relMapping: res.with_mapping,
            };
        });
    }

    saveModel({ url, data, isNew, requestOptions }) {
        const method = isNew ? 'post' : 'patch';
        return this[method](url, data, requestOptions)
            .then(newData => {
                return { data: newData };
            })
            .catch(err => {
                if (err.response) {
                    err.valErrors = this.parseBackendValidationErrors(
                        err.response
                    );
                }
                throw err;
            });
    }

    saveAllModels({ url, data, model, requestOptions }) {
        return this.put(
            url,
            {
                data: data.data,
                with: data.relations,
            },
            requestOptions
        )
            .then(res => {
                if (res.idmap) {
                    model.__parseNewIds(res.idmap);
                }
                return res;
            })
            .catch(err => {
                if (err.response) {
                    err.valErrors = this.parseBackendValidationErrors(
                        err.response
                    );
                }
                throw err;
            });
    }

    deleteModel({ url, requestOptions }) {
        // TODO: kind of silly now, but we'll probably want better error handling soon.
        return this.delete(url, null, requestOptions);
    }

    buildFetchStoreParams(store) {
        const offset = store.getPageOffset();
        return {
            with:
                store.__activeRelations
                    .map(store.Model.toBackendAttrKey)
                    .join(',') || null,
            limit: store.__state.limit,
            // Hide offset if zero so the request looks cleaner in DevTools.
            offset: offset || null,
        };
    }

    fetchStore({ url, data, requestOptions }) {
        return this.get(url, data, requestOptions).then(res => {
            return {
                data: res.data,
                repos: res.with,
                relMapping: res.with_mapping,
                totalRecords: res.meta.total_records,
            };
        });
    }
}
