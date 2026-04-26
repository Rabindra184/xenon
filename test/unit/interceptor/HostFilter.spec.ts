import { expect } from 'chai';
import { HostFilter } from '../../../src/services/interceptor/HostFilter';

describe('HostFilter', () => {
  describe('default (no patterns)', () => {
    it('accepts every host when both lists are absent', () => {
      const f = new HostFilter();
      expect(f.accepts('api.example.com')).to.equal(true);
      expect(f.accepts('cdn.evil.example')).to.equal(true);
    });

    it('treats empty arrays the same as absent', () => {
      const f = new HostFilter({ include: [], exclude: [] });
      expect(f.accepts('api.example.com')).to.equal(true);
    });
  });

  describe('include only (allowlist)', () => {
    it('passes hosts that match an include pattern', () => {
      const f = new HostFilter({ include: ['api.example.com'] });
      expect(f.accepts('api.example.com')).to.equal(true);
    });

    it('drops hosts that do not match any include pattern', () => {
      const f = new HostFilter({ include: ['api.example.com'] });
      expect(f.accepts('cdn.example.com')).to.equal(false);
      expect(f.accepts('evil.com')).to.equal(false);
    });

    it('supports a single-label wildcard with *', () => {
      const f = new HostFilter({ include: ['*.example.com'] });
      expect(f.accepts('api.example.com')).to.equal(true);
      expect(f.accepts('cdn.example.com')).to.equal(true);
      // single * does not cross dots — sub.api.example.com has two labels before example.com
      expect(f.accepts('sub.api.example.com')).to.equal(false);
      // bare apex doesn't match *.example.com (need at least one label)
      expect(f.accepts('example.com')).to.equal(false);
    });

    it('supports a multi-label wildcard with **', () => {
      const f = new HostFilter({ include: ['**.example.com'] });
      expect(f.accepts('api.example.com')).to.equal(true);
      expect(f.accepts('sub.api.example.com')).to.equal(true);
      // ** matches zero or more labels, so apex matches too
      expect(f.accepts('example.com')).to.equal(true);
      expect(f.accepts('evil.com')).to.equal(false);
    });

    it('supports a bare * (matches any host)', () => {
      const f = new HostFilter({ include: ['*'] });
      expect(f.accepts('anything.tld')).to.equal(true);
    });

    it('matches if any include pattern matches (OR semantics)', () => {
      const f = new HostFilter({ include: ['api.example.com', '*.cdn.com'] });
      expect(f.accepts('api.example.com')).to.equal(true);
      expect(f.accepts('a.cdn.com')).to.equal(true);
      expect(f.accepts('other.com')).to.equal(false);
    });
  });

  describe('exclude only (denylist)', () => {
    it('drops hosts that match an exclude pattern', () => {
      const f = new HostFilter({ exclude: ['telemetry.example.com'] });
      expect(f.accepts('telemetry.example.com')).to.equal(false);
      expect(f.accepts('api.example.com')).to.equal(true);
    });

    it('supports wildcards in exclude', () => {
      const f = new HostFilter({ exclude: ['*.tracking.com', '**.ads.com'] });
      expect(f.accepts('a.tracking.com')).to.equal(false);
      expect(f.accepts('a.b.ads.com')).to.equal(false);
      expect(f.accepts('api.example.com')).to.equal(true);
    });
  });

  describe('include + exclude combined', () => {
    it('applies include first, then exclude (exclude can carve out of include)', () => {
      const f = new HostFilter({
        include: ['**.example.com'],
        exclude: ['telemetry.example.com'],
      });
      expect(f.accepts('api.example.com')).to.equal(true);
      expect(f.accepts('telemetry.example.com')).to.equal(false);
      expect(f.accepts('other.com')).to.equal(false);
    });
  });

  describe('case insensitivity', () => {
    it('matches regardless of case in either pattern or host', () => {
      const f = new HostFilter({ include: ['API.Example.COM'] });
      expect(f.accepts('api.example.com')).to.equal(true);
      expect(f.accepts('API.EXAMPLE.COM')).to.equal(true);
    });
  });

  describe('regex special chars in pattern', () => {
    it('treats dots as literals, not as regex any-char', () => {
      const f = new HostFilter({ include: ['api.example.com'] });
      // The regex-naive implementation would match 'apiXexampleXcom' here. Guard.
      expect(f.accepts('apixexamplexcom')).to.equal(false);
    });
  });
});
