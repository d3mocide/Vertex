from unittest.mock import AsyncMock
import httpx
import pytest
import security


@pytest.mark.asyncio
async def test_https_pin_preserves_text_sni_and_original_host(monkeypatch):
    monkeypatch.setattr(security, 'resolve_safe_ip', AsyncMock(return_value='8.8.8.8'))
    async def respond(request):
        assert request.url.host == '8.8.8.8'
        assert request.headers['Host'] == 'example.org'
        assert request.extensions['sni_hostname'] == 'example.org'
        return httpx.Response(200, request=request)
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        response = await security.send_pinned_http_request(client, 'GET', 'https://example.org/data')
        assert response.status_code == 200


def test_wsdot_access_code_is_redacted_from_urls_and_exceptions():
    from redaction import redact_url, redact_text
    url='https://example.org/data?AccessCode=fixture-access-code'
    assert 'fixture-access-code' not in redact_url(url)
    assert 'fixture-access-code' not in redact_text('Request failed: '+url)
