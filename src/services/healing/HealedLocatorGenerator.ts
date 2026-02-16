import { Service } from 'typedi';
import log from '../../logger';

@Service()
export class HealedLocatorGenerator {
    private logger = log.scope('LocatorGenerator');

    /**
     * Generates a set of candidate locators for a healed node, ranked by stability.
     */
    public generate(node: any): string[] {
        const candidates: string[] = [];
        const tagName = node.nodeName || node.tag;

        if (!tagName) return [];

        const attrs: Record<string, string> = {};
        if (node.attributes) {
            for (let i = 0; i < node.attributes.length; i++) {
                const attr = node.attributes[i];
                attrs[attr.name.toLowerCase()] = attr.value;
            }
        } else if (node.attrs) {
            // Handle ResilioTree node format if different
            Object.assign(attrs, node.attrs);
        }

        // 1. Content-Desc (Very stable in Android)
        if (attrs['content-desc']) {
            candidates.push(`//*[contains(@content-desc, '${attrs['content-desc']}')]`);
            candidates.push(`//${tagName}[@content-desc='${attrs['content-desc']}']`);
        }

        // 2. Resource-ID (Stable in Android/iOS)
        if (attrs['resource-id']) {
            candidates.push(`//*[@resource-id='${attrs['resource-id']}']`);
        }

        // 3. Text content (Stable but can change)
        const textValue = attrs['text'] || node.textContent;
        if (textValue && textValue.length > 2 && textValue.length < 50) {
            candidates.push(`//${tagName}[@text='${textValue}']`);
            candidates.push(`//*[contains(@text, '${textValue}')]`);
        }

        // 4. Name attribute
        if (attrs['name']) {
            candidates.push(`//${tagName}[@name='${attrs['name']}']`);
        }

        // 5. Parent-Relative (Healenium style)
        const parent = node.parentNode || node.parent;
        if (parent) {
            const parentTag = parent.nodeName || parent.tag;
            const parentResourceId = (parent.attributes && this.getAttr(parent, 'resource-id')) || (parent.attrs && parent.attrs['resource-id']);

            if (parentResourceId) {
                candidates.push(`//*[@resource-id='${parentResourceId}']//${tagName}`);
            } else if (parentTag && parentTag !== 'HTML' && parentTag !== 'BODY') {
                candidates.push(`//${parentTag}//${tagName}`);
            }
        }

        // 6. Absolute XPath (Fallback)
        candidates.push(this.generateAbsoluteXpath(node));

        // Return unique non-empty candidates
        return [...new Set(candidates)].filter(Boolean);
    }

    private getAttr(node: any, name: string): string | null {
        if (!node.attributes) return null;
        for (let i = 0; i < node.attributes.length; i++) {
            if (node.attributes[i].name.toLowerCase() === name) return node.attributes[i].value;
        }
        return null;
    }

    private generateAbsoluteXpath(node: any): string {
        const parts: string[] = [];
        let current: any = node;
        while (current && current.nodeType === 1) {
            let index = 0;
            let sibling = current.previousSibling;
            while (sibling) {
                if (sibling.nodeType === 1 && sibling.nodeName === current.nodeName) {
                    index++;
                }
                sibling = sibling.previousSibling;
            }
            const tag = current.nodeName || current.tag;
            // Skip wrapper tags for cleaner XPath
            if (tag.toLowerCase() !== 'html' && tag.toLowerCase() !== 'body') {
                const pathIndex = index > 0 ? `[${index + 1}]` : '';
                parts.unshift(`${tag}${pathIndex}`);
            }
            current = current.parentNode || current.parent;
        }
        return `/${parts.join('/')}`;
    }
}
