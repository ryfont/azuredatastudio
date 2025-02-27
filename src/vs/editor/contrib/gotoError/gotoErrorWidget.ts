/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import { ScrollableElement } from 'vs/base/browser/ui/scrollbar/scrollableElement';
import { IAction } from 'vs/base/common/actions';
import { isNonEmptyArray } from 'vs/base/common/arrays';
import { Color } from 'vs/base/common/color';
import { Emitter, Event } from 'vs/base/common/event';
import { getBaseLabel } from 'vs/base/common/labels';
import { DisposableStore, dispose } from 'vs/base/common/lifecycle';
import { basename } from 'vs/base/common/resources';
import { ScrollbarVisibility } from 'vs/base/common/scrollable';
import { splitLines } from 'vs/base/common/strings';
import 'vs/css!./media/gotoErrorWidget';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditorOption } from 'vs/editor/common/config/editorOptions';
import { Range } from 'vs/editor/common/core/range';
import { ScrollType } from 'vs/editor/common/editorCommon';
import { peekViewTitleForeground, peekViewTitleInfoForeground, PeekViewWidget } from 'vs/editor/contrib/peekView/peekView';
import * as nls from 'vs/nls';
import { createAndFillInActionBarActions } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { IMenuService, MenuId } from 'vs/platform/actions/common/actions';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ILabelService } from 'vs/platform/label/common/label';
import { IMarker, IRelatedInformation, MarkerSeverity } from 'vs/platform/markers/common/markers';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { SeverityIcon } from 'vs/platform/severityIcon/common/severityIcon';
import { contrastBorder, editorBackground, editorErrorBorder, editorErrorForeground, editorInfoBorder, editorInfoForeground, editorWarningBorder, editorWarningForeground, oneOf, registerColor, textLinkActiveForeground, textLinkForeground, transparent } from 'vs/platform/theme/common/colorRegistry';
import { IColorTheme, IThemeService, registerThemingParticipant } from 'vs/platform/theme/common/themeService';

class MessageWidget {

	private _lines: number = 0;
	private _longestLineLength: number = 0;

	private readonly _editor: ICodeEditor;
	private readonly _messageBlock: HTMLDivElement;
	private readonly _relatedBlock: HTMLDivElement;
	private readonly _scrollable: ScrollableElement;
	private readonly _relatedDiagnostics = new WeakMap<HTMLElement, IRelatedInformation>();
	private readonly _disposables: DisposableStore = new DisposableStore();

	private _codeLink?: HTMLElement;

	constructor(
		parent: HTMLElement,
		editor: ICodeEditor,
		onRelatedInformation: (related: IRelatedInformation) => void,
		private readonly _openerService: IOpenerService,
		private readonly _labelService: ILabelService
	) {
		this._editor = editor;

		const domNode = document.createElement('div');
		domNode.className = 'descriptioncontainer';

		this._messageBlock = document.createElement('div');
		this._messageBlock.classList.add('message');
		this._messageBlock.setAttribute('aria-live', 'assertive');
		this._messageBlock.setAttribute('role', 'alert');
		domNode.appendChild(this._messageBlock);

		this._relatedBlock = document.createElement('div');
		domNode.appendChild(this._relatedBlock);
		this._disposables.add(dom.addStandardDisposableListener(this._relatedBlock, 'click', event => {
			event.preventDefault();
			const related = this._relatedDiagnostics.get(event.target);
			if (related) {
				onRelatedInformation(related);
			}
		}));

		this._scrollable = new ScrollableElement(domNode, {
			horizontal: ScrollbarVisibility.Auto,
			vertical: ScrollbarVisibility.Auto,
			useShadows: false,
			horizontalScrollbarSize: 3,
			verticalScrollbarSize: 3
		});
		parent.appendChild(this._scrollable.getDomNode());
		this._disposables.add(this._scrollable.onScroll(e => {
			domNode.style.left = `-${e.scrollLeft}px`;
			domNode.style.top = `-${e.scrollTop}px`;
		}));
		this._disposables.add(this._scrollable);
	}

	dispose(): void {
		dispose(this._disposables);
	}

	update(marker: IMarker): void {
		const { source, message, relatedInformation, code } = marker;
		let sourceAndCodeLength = (source?.length || 0) + '()'.length;
		if (code) {
			if (typeof code === 'string') {
				sourceAndCodeLength += code.length;
			} else {
				sourceAndCodeLength += code.value.length;
			}
		}

		const lines = splitLines(message);
		this._lines = lines.length;
		this._longestLineLength = 0;
		for (const line of lines) {
			this._longestLineLength = Math.max(line.length + sourceAndCodeLength, this._longestLineLength);
		}

		dom.clearNode(this._messageBlock);
		this._messageBlock.setAttribute('aria-label', this.getAriaLabel(marker));
		this._editor.applyFontInfo(this._messageBlock);
		let lastLineElement = this._messageBlock;
		for (const line of lines) {
			lastLineElement = document.createElement('div');
			lastLineElement.innerText = line;
			if (line === '') {
				lastLineElement.style.height = this._messageBlock.style.lineHeight;
			}
			this._messageBlock.appendChild(lastLineElement);
		}
		if (source || code) {
			const detailsElement = document.createElement('span');
			detailsElement.classList.add('details');
			lastLineElement.appendChild(detailsElement);
			if (source) {
				const sourceElement = document.createElement('span');
				sourceElement.innerText = source;
				sourceElement.classList.add('source');
				detailsElement.appendChild(sourceElement);
			}
			if (code) {
				if (typeof code === 'string') {
					const codeElement = document.createElement('span');
					codeElement.innerText = `(${code})`;
					codeElement.classList.add('code');
					detailsElement.appendChild(codeElement);
				} else {
					this._codeLink = dom.$('a.code-link');
					this._codeLink.setAttribute('href', `${code.target.toString()}`);

					this._codeLink.onclick = (e) => {
						this._openerService.open(code.target, { allowCommands: true });
						e.preventDefault();
						e.stopPropagation();
					};

					const codeElement = dom.append(this._codeLink, dom.$('span'));
					codeElement.innerText = code.value;
					detailsElement.appendChild(this._codeLink);
				}
			}
		}

		dom.clearNode(this._relatedBlock);
		this._editor.applyFontInfo(this._relatedBlock);
		if (isNonEmptyArray(relatedInformation)) {
			const relatedInformationNode = this._relatedBlock.appendChild(document.createElement('div'));
			relatedInformationNode.style.paddingTop = `${Math.floor(this._editor.getOption(EditorOption.lineHeight) * 0.66)}px`;
			this._lines += 1;

			for (const related of relatedInformation) {

				let container = document.createElement('div');

				let relatedResource = document.createElement('a');
				relatedResource.classList.add('filename');
				relatedResource.innerText = `${getBaseLabel(related.resource)}(${related.startLineNumber}, ${related.startColumn}): `;
				relatedResource.title = this._labelService.getUriLabel(related.resource);
				this._relatedDiagnostics.set(relatedResource, related);

				let relatedMessage = document.createElement('span');
				relatedMessage.innerText = related.message;

				container.appendChild(relatedResource);
				container.appendChild(relatedMessage);

				this._lines += 1;
				relatedInformationNode.appendChild(container);
			}
		}

		const fontInfo = this._editor.getOption(EditorOption.fontInfo);
		const scrollWidth = Math.ceil(fontInfo.typicalFullwidthCharacterWidth * this._longestLineLength * 0.75);
		const scrollHeight = fontInfo.lineHeight * this._lines;
		this._scrollable.setScrollDimensions({ scrollWidth, scrollHeight });
	}

	layout(height: number, width: number): void {
		this._scrollable.getDomNode().style.height = `${height}px`;
		this._scrollable.getDomNode().style.width = `${width}px`;
		this._scrollable.setScrollDimensions({ width, height });
	}

	getHeightInLines(): number {
		return Math.min(17, this._lines);
	}

	private getAriaLabel(marker: IMarker): string {
		let severityLabel = '';
		switch (marker.severity) {
			case MarkerSeverity.Error:
				severityLabel = nls.localize('Error', "Error");
				break;
			case MarkerSeverity.Warning:
				severityLabel = nls.localize('Warning', "Warning");
				break;
			case MarkerSeverity.Info:
				severityLabel = nls.localize('Info', "Info");
				break;
			case MarkerSeverity.Hint:
				severityLabel = nls.localize('Hint', "Hint");
				break;
		}

		let ariaLabel = nls.localize('marker aria', "{0} at {1}. ", severityLabel, marker.startLineNumber + ':' + marker.startColumn);
		const model = this._editor.getModel();
		if (model && (marker.startLineNumber <= model.getLineCount()) && (marker.startLineNumber >= 1)) {
			const lineContent = model.getLineContent(marker.startLineNumber);
			ariaLabel = `${lineContent}, ${ariaLabel}`;
		}
		return ariaLabel;
	}
}

export class MarkerNavigationWidget extends PeekViewWidget {

	static readonly TitleMenu = new MenuId('gotoErrorTitleMenu');

	private _parentContainer!: HTMLElement;
	private _container!: HTMLElement;
	private _icon!: HTMLElement;
	private _message!: MessageWidget;
	private readonly _callOnDispose = new DisposableStore();
	private _severity: MarkerSeverity;
	private _backgroundColor?: Color;
	private readonly _onDidSelectRelatedInformation = new Emitter<IRelatedInformation>();
	private _heightInPixel!: number;

	readonly onDidSelectRelatedInformation: Event<IRelatedInformation> = this._onDidSelectRelatedInformation.event;

	constructor(
		editor: ICodeEditor,
		@IThemeService private readonly _themeService: IThemeService,
		@IOpenerService private readonly _openerService: IOpenerService,
		@IMenuService private readonly _menuService: IMenuService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@ILabelService private readonly _labelService: ILabelService
	) {
		super(editor, { showArrow: true, showFrame: true, isAccessible: true, frameWidth: 1 }, instantiationService);
		this._severity = MarkerSeverity.Warning;
		this._backgroundColor = Color.white;

		this._applyTheme(_themeService.getColorTheme());
		this._callOnDispose.add(_themeService.onDidColorThemeChange(this._applyTheme.bind(this)));

		this.create();
	}

	private _applyTheme(theme: IColorTheme) {
		this._backgroundColor = theme.getColor(editorMarkerNavigationBackground);
		let colorId = editorMarkerNavigationError;
		let headerBackground = editorMarkerNavigationErrorHeader;

		if (this._severity === MarkerSeverity.Warning) {
			colorId = editorMarkerNavigationWarning;
			headerBackground = editorMarkerNavigationWarningHeader;
		} else if (this._severity === MarkerSeverity.Info) {
			colorId = editorMarkerNavigationInfo;
			headerBackground = editorMarkerNavigationInfoHeader;
		}

		const frameColor = theme.getColor(colorId);
		const headerBg = theme.getColor(headerBackground);

		this.style({
			arrowColor: frameColor,
			frameColor: frameColor,
			headerBackgroundColor: headerBg,
			primaryHeadingColor: theme.getColor(peekViewTitleForeground),
			secondaryHeadingColor: theme.getColor(peekViewTitleInfoForeground)
		}); // style() will trigger _applyStyles
	}

	protected override _applyStyles(): void {
		if (this._parentContainer) {
			this._parentContainer.style.backgroundColor = this._backgroundColor ? this._backgroundColor.toString() : '';
		}
		super._applyStyles();
	}

	override dispose(): void {
		this._callOnDispose.dispose();
		super.dispose();
	}

	focus(): void {
		this._parentContainer.focus();
	}

	protected override _fillHead(container: HTMLElement): void {
		super._fillHead(container);

		this._disposables.add(this._actionbarWidget!.actionRunner.onBeforeRun(e => this.editor.focus()));

		const actions: IAction[] = [];
		const menu = this._menuService.createMenu(MarkerNavigationWidget.TitleMenu, this._contextKeyService);
		createAndFillInActionBarActions(menu, undefined, actions);
		this._actionbarWidget!.push(actions, { label: false, icon: true, index: 0 });
		menu.dispose();
	}

	protected override _fillTitleIcon(container: HTMLElement): void {
		this._icon = dom.append(container, dom.$(''));
	}

	protected _fillBody(container: HTMLElement): void {
		this._parentContainer = container;
		container.classList.add('marker-widget');
		this._parentContainer.tabIndex = 0;
		this._parentContainer.setAttribute('role', 'tooltip');

		this._container = document.createElement('div');
		container.appendChild(this._container);

		this._message = new MessageWidget(this._container, this.editor, related => this._onDidSelectRelatedInformation.fire(related), this._openerService, this._labelService);
		this._disposables.add(this._message);
	}

	override show(): void {
		throw new Error('call showAtMarker');
	}

	showAtMarker(marker: IMarker, markerIdx: number, markerCount: number): void {
		// update:
		// * title
		// * message
		this._container.classList.remove('stale');
		this._message.update(marker);

		// update frame color (only applied on 'show')
		this._severity = marker.severity;
		this._applyTheme(this._themeService.getColorTheme());

		// show
		let range = Range.lift(marker);
		const editorPosition = this.editor.getPosition();
		let position = editorPosition && range.containsPosition(editorPosition) ? editorPosition : range.getStartPosition();
		super.show(position, this.computeRequiredHeight());

		const model = this.editor.getModel();
		if (model) {
			const detail = markerCount > 1
				? nls.localize('problems', "{0} of {1} problems", markerIdx, markerCount)
				: nls.localize('change', "{0} of {1} problem", markerIdx, markerCount);
			this.setTitle(basename(model.uri), detail);
		}
		this._icon.className = `codicon ${SeverityIcon.className(MarkerSeverity.toSeverity(this._severity))}`;

		this.editor.revealPositionNearTop(position, ScrollType.Smooth);
		this.editor.focus();
	}

	updateMarker(marker: IMarker): void {
		this._container.classList.remove('stale');
		this._message.update(marker);
	}

	showStale() {
		this._container.classList.add('stale');
		this._relayout();
	}

	protected override _doLayoutBody(heightInPixel: number, widthInPixel: number): void {
		super._doLayoutBody(heightInPixel, widthInPixel);
		this._heightInPixel = heightInPixel;
		this._message.layout(heightInPixel, widthInPixel);
		this._container.style.height = `${heightInPixel}px`;
	}

	public override _onWidth(widthInPixel: number): void {
		this._message.layout(this._heightInPixel, widthInPixel);
	}

	protected override _relayout(): void {
		super._relayout(this.computeRequiredHeight());
	}

	private computeRequiredHeight() {
		return 3 + this._message.getHeightInLines();
	}
}

// theming

let errorDefault = oneOf(editorErrorForeground, editorErrorBorder);
let warningDefault = oneOf(editorWarningForeground, editorWarningBorder);
let infoDefault = oneOf(editorInfoForeground, editorInfoBorder);

export const editorMarkerNavigationError = registerColor('editorMarkerNavigationError.background', { dark: errorDefault, light: errorDefault, hc: contrastBorder }, nls.localize('editorMarkerNavigationError', 'Editor marker navigation widget error color.'));
export const editorMarkerNavigationErrorHeader = registerColor('editorMarkerNavigationError.headerBackground', { dark: transparent(editorMarkerNavigationError, .1), light: transparent(editorMarkerNavigationError, .1), hc: null }, nls.localize('editorMarkerNavigationErrorHeaderBackground', 'Editor marker navigation widget error heading background.'));

export const editorMarkerNavigationWarning = registerColor('editorMarkerNavigationWarning.background', { dark: warningDefault, light: warningDefault, hc: contrastBorder }, nls.localize('editorMarkerNavigationWarning', 'Editor marker navigation widget warning color.'));
export const editorMarkerNavigationWarningHeader = registerColor('editorMarkerNavigationWarning.headerBackground', { dark: transparent(editorMarkerNavigationWarning, .1), light: transparent(editorMarkerNavigationWarning, .1), hc: '#0C141F' }, nls.localize('editorMarkerNavigationWarningBackground', 'Editor marker navigation widget warning heading background.'));

export const editorMarkerNavigationInfo = registerColor('editorMarkerNavigationInfo.background', { dark: infoDefault, light: infoDefault, hc: contrastBorder }, nls.localize('editorMarkerNavigationInfo', 'Editor marker navigation widget info color.'));
export const editorMarkerNavigationInfoHeader = registerColor('editorMarkerNavigationInfo.headerBackground', { dark: transparent(editorMarkerNavigationInfo, .1), light: transparent(editorMarkerNavigationInfo, .1), hc: null }, nls.localize('editorMarkerNavigationInfoHeaderBackground', 'Editor marker navigation widget info heading background.'));

export const editorMarkerNavigationBackground = registerColor('editorMarkerNavigation.background', { dark: editorBackground, light: editorBackground, hc: editorBackground }, nls.localize('editorMarkerNavigationBackground', 'Editor marker navigation widget background.'));

registerThemingParticipant((theme, collector) => {
	const linkFg = theme.getColor(textLinkForeground);
	if (linkFg) {
		collector.addRule(`.monaco-editor .marker-widget a.code-link span { color: ${linkFg}; }`);
	}
	const activeLinkFg = theme.getColor(textLinkActiveForeground);
	if (activeLinkFg) {
		collector.addRule(`.monaco-editor .marker-widget a.code-link span:hover { color: ${activeLinkFg}; }`);
	}
});
