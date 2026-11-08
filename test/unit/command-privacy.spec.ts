import 'reflect-metadata';
import { expect } from 'chai';
import {
  MASKED,
  inputMasked,
  isSensitiveHeaderValue,
  maskTypedText,
  sensitiveResponse,
} from '../../src/dashboard/commandPrivacy';
import { commandLogFields } from '../../src/dashboard/commandLogFields';
import {
  XENON_CAPABILITIES,
  getXenonCapabilities,
  maskInputOfCaps,
} from '../../src/XenonCapabilityManager';

/**
 * What Xenon's command log and spans keep of a command that typed. Through
 * 2.20 they kept the text a test typed, a password included, as sent.
 */
describe('typed text in the command log', () => {
  const PASSWORD = 'hunter2-Secret!';

  describe('maskTypedText', () => {
    it("masks setValue's text, keeping its element, as CommandInterceptor and a hub see it", () => {
      expect(maskTypedText('setValue', [PASSWORD, 'el-1', 's-1'])).to.deep.equal([
        MASKED,
        'el-1',
        's-1',
      ]);
      expect(maskTypedText('setValue', { text: PASSWORD, value: [...PASSWORD] })).to.deep.equal({
        text: MASKED,
        value: MASKED,
      });
    });

    it('masks replaceValue and keys', () => {
      expect(maskTypedText('replaceValue', [PASSWORD, 'el-1'])).to.deep.equal([MASKED, 'el-1']);
      expect(maskTypedText('replaceValue', { text: PASSWORD })).to.deep.equal({ text: MASKED });
      expect(maskTypedText('keys', { value: [...PASSWORD] })).to.deep.equal({ value: MASKED });
    });

    it("masks a key action's values and keeps pointer actions", () => {
      const actions = [
        {
          type: 'key',
          id: 'kb',
          actions: [
            { type: 'keyDown', value: 'h' },
            { type: 'pause', duration: 5 },
            { type: 'keyUp', value: 'h' },
          ],
        },
        {
          type: 'pointer',
          id: 'f',
          actions: [
            { type: 'pointerMove', x: 10, y: 20 },
            { type: 'pointerDown', button: 0 },
          ],
        },
      ];
      const masked = maskTypedText('performActions', { actions }) as any;
      expect(masked.actions[0].actions).to.deep.equal([
        { type: 'keyDown', value: MASKED },
        { type: 'pause', duration: 5 },
        { type: 'keyUp', value: MASKED },
      ]);
      expect(masked.actions[1]).to.deep.equal(actions[1]);
      expect((maskTypedText('performActions', [actions]) as any)[0][0].actions[0].value).to.equal(
        MASKED,
      );
    });

    it("masks the drivers' typing scripts, and no other script", () => {
      expect(
        maskTypedText('execute', { script: 'mobile: type', args: [{ text: PASSWORD }] }),
      ).to.deep.equal({
        script: 'mobile: type',
        args: [{ text: MASKED }],
      });
      expect(
        maskTypedText('execute', [
          'mobile: replaceElementValue',
          [{ elementId: 'el-1', text: PASSWORD }],
        ]),
      ).to.deep.equal(['mobile: replaceElementValue', [{ elementId: 'el-1', text: MASKED }]]);
      expect(
        maskTypedText('execute', { script: 'mobile: keys', args: [{ keys: [...PASSWORD] }] }),
      ).to.deep.equal({
        script: 'mobile: keys',
        args: [{ keys: MASKED }],
      });
      const other = { script: 'mobile: scroll', args: [{ direction: 'down' }] };
      expect(maskTypedText('execute', other)).to.equal(other);
    });

    it('leaves every other command as it was', () => {
      const find = ['xpath', '//android.widget.EditText'];
      expect(maskTypedText('findElement', find)).to.equal(find);
      expect(maskTypedText('click', ['el-1'])).to.deep.equal(['el-1']);
    });
  });

  it("reads Appium's X-Appium-Is-Sensitive values", () => {
    for (const on of ['true', 'TRUE', '1', 'yes', ['true']])
      expect(isSensitiveHeaderValue(on), String(on)).to.equal(true);
    for (const off of ['false', '0', '', 'on', undefined])
      expect(isSensitiveHeaderValue(off), String(off)).to.equal(false);
  });

  it("keeps a failure's error code and nothing else of a sensitive command's answer", () => {
    expect(JSON.parse(sensitiveResponse(JSON.stringify({ value: 'Pay now' }), true))).to.deep.equal(
      {
        value: MASKED,
      },
    );
    const failed = JSON.stringify({
      value: { error: 'invalid argument', message: `bad: ${PASSWORD}` },
    });
    expect(JSON.parse(sensitiveResponse(failed, false))).to.deep.equal({
      value: { error: 'invalid argument', message: MASKED },
    });
    expect(JSON.parse(sensitiveResponse('not json', false)).value.error).to.equal('unknown error');
  });

  describe('commandLogFields', () => {
    it('keeps neither the arguments nor the answer of a sensitive command', () => {
      const out = commandLogFields('getText', ['el-1'], JSON.stringify({ value: PASSWORD }), true, {
        sensitive: true,
      });
      expect(`${out.body}${out.response}`).not.to.include(PASSWORD);
      expect(JSON.parse(out.body)).to.equal(MASKED);
    });

    it('masks typed text when the session masks input, and only then', () => {
      const masked = commandLogFields('setValue', [PASSWORD, 'el-1'], '{"value":null}', true, {
        maskInput: true,
      });
      expect(JSON.parse(masked.body)).to.deep.equal([MASKED, 'el-1']);
      const kept = commandLogFields('setValue', [PASSWORD, 'el-1'], '{"value":null}', true);
      expect(JSON.parse(kept.body)).to.deep.equal([PASSWORD, 'el-1']);
    });
  });

  describe('xe:options.maskInput', () => {
    it('is read in every form a Xenon option takes', () => {
      for (const caps of [
        { 'xe:options': { maskInput: true } },
        { 'xenon:options': { maskInput: 'true' } },
        { 'xe:maskInput': true },
        { 'xe:mask_input': 'true' },
      ]) {
        expect(maskInputOfCaps(caps), JSON.stringify(caps)).to.equal(true);
        expect(
          getXenonCapabilities({ alwaysMatch: caps, firstMatch: [{}] } as any)[
            XENON_CAPABILITIES.MASK_INPUT
          ],
        ).to.equal(true);
      }
      for (const caps of [
        {},
        { 'xe:options': { maskInput: false } },
        { 'xe:options': { maskInput: 'yes' } },
        undefined,
      ]) {
        expect(maskInputOfCaps(caps as any), JSON.stringify(caps)).to.equal(false);
      }
    });

    it("can't turn off the server's option", () => {
      expect(inputMasked(true, false)).to.equal(true);
      expect(inputMasked(false, true)).to.equal(true);
      expect(inputMasked(undefined, undefined)).to.equal(false);
    });
  });
});
