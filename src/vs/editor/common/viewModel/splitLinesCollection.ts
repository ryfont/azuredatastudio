/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as arrays from 'vs/base/common/arrays';
import { WrappingIndent } from 'vs/editor/common/config/editorOptions';
import { IViewLineTokens, LineTokens } from 'vs/editor/common/core/lineTokens';
import { IPosition, Position } from 'vs/editor/common/core/position';
import { IRange, Range } from 'vs/editor/common/core/range';
import { BracketGuideOptions, EndOfLinePreference, IActiveIndentGuideInfo, IModelDecoration, IModelDeltaDecoration, IndentGuide, IndentGuideHorizontalLine, ITextModel, PositionAffinity } from 'vs/editor/common/model';
import { ModelDecorationOptions } from 'vs/editor/common/model/textModel';
import * as viewEvents from 'vs/editor/common/view/viewEvents';
import { ICoordinatesConverter, InjectedText, ILineBreaksComputer, LineBreakData, SingleLineInlineDecoration, ViewLineData } from 'vs/editor/common/viewModel/viewModel';
import { IDisposable } from 'vs/base/common/lifecycle';
import { FontInfo } from 'vs/editor/common/config/fontInfo';
import { LineInjectedText } from 'vs/editor/common/model/textModelEvents';
import { ConstantTimePrefixSumComputer } from 'vs/editor/common/viewModel/prefixSumComputer';

export interface ILineBreaksComputerFactory {
	createLineBreaksComputer(fontInfo: FontInfo, tabSize: number, wrappingColumn: number, wrappingIndent: WrappingIndent): ILineBreaksComputer;
}

export interface ISimpleModel {
	getLineTokens(lineNumber: number): LineTokens;
	getLineContent(lineNumber: number): string;
	getLineLength(lineNumber: number): number;
	getLineMinColumn(lineNumber: number): number;
	getLineMaxColumn(lineNumber: number): number;
	getValueInRange(range: IRange, eol?: EndOfLinePreference): string;
}

export interface IModelLineProjection {
	isVisible(): boolean;
	setVisible(isVisible: boolean): IModelLineProjection;

	getLineBreakData(): LineBreakData | null;
	getViewLineCount(): number;
	getViewLineContent(model: ISimpleModel, modelLineNumber: number, outputLineIndex: number): string;
	getViewLineLength(model: ISimpleModel, modelLineNumber: number, outputLineIndex: number): number;
	getViewLineMinColumn(model: ISimpleModel, modelLineNumber: number, outputLineIndex: number): number;
	getViewLineMaxColumn(model: ISimpleModel, modelLineNumber: number, outputLineIndex: number): number;
	getViewLineData(model: ISimpleModel, modelLineNumber: number, outputLineIndex: number): ViewLineData;
	getViewLinesData(model: ISimpleModel, modelLineNumber: number, fromOuputLineIndex: number, toOutputLineIndex: number, globalStartIndex: number, needed: boolean[], result: Array<ViewLineData | null>): void;

	getModelColumnOfViewPosition(outputLineIndex: number, outputColumn: number): number;
	getViewPositionOfModelPosition(deltaLineNumber: number, inputColumn: number, affinity?: PositionAffinity): Position;
	getViewLineNumberOfModelPosition(deltaLineNumber: number, inputColumn: number): number;
	normalizePosition(model: ISimpleModel, modelLineNumber: number, outputLineIndex: number, outputPosition: Position, affinity: PositionAffinity): Position;

	getInjectedTextAt(outputLineIndex: number, column: number): InjectedText | null;
}

export interface IViewModelLinesCollection extends IDisposable {
	createCoordinatesConverter(): ICoordinatesConverter;

	setWrappingSettings(fontInfo: FontInfo, wrappingStrategy: 'simple' | 'advanced', wrappingColumn: number, wrappingIndent: WrappingIndent): boolean;
	setTabSize(newTabSize: number): boolean;
	getHiddenAreas(): Range[];
	setHiddenAreas(_ranges: Range[]): boolean;

	createLineBreaksComputer(): ILineBreaksComputer;
	onModelFlushed(): void;
	onModelLinesDeleted(versionId: number | null, fromLineNumber: number, toLineNumber: number): viewEvents.ViewLinesDeletedEvent | null;
	onModelLinesInserted(versionId: number | null, fromLineNumber: number, toLineNumber: number, lineBreaks: (LineBreakData | null)[]): viewEvents.ViewLinesInsertedEvent | null;
	onModelLineChanged(versionId: number | null, lineNumber: number, lineBreakData: LineBreakData | null): [boolean, viewEvents.ViewLinesChangedEvent | null, viewEvents.ViewLinesInsertedEvent | null, viewEvents.ViewLinesDeletedEvent | null];
	acceptVersionId(versionId: number): void;

	getViewLineCount(): number;
	getActiveIndentGuide(viewLineNumber: number, minLineNumber: number, maxLineNumber: number): IActiveIndentGuideInfo;
	getViewLinesIndentGuides(viewStartLineNumber: number, viewEndLineNumber: number): number[];
	getViewLinesBracketGuides(startLineNumber: number, endLineNumber: number, activePosition: IPosition | null, options: BracketGuideOptions): IndentGuide[][];
	getViewLineContent(viewLineNumber: number): string;
	getViewLineLength(viewLineNumber: number): number;
	getViewLineMinColumn(viewLineNumber: number): number;
	getViewLineMaxColumn(viewLineNumber: number): number;
	getViewLineData(viewLineNumber: number): ViewLineData;
	getViewLinesData(viewStartLineNumber: number, viewEndLineNumber: number, needed: boolean[]): Array<ViewLineData | null>;

	getDecorationsInRange(range: Range, ownerId: number, filterOutValidation: boolean): IModelDecoration[];

	getInjectedTextAt(viewPosition: Position): InjectedText | null;

	normalizePosition(position: Position, affinity: PositionAffinity): Position;
	/**
	 * Gets the column at which indentation stops at a given line.
	 * @internal
	*/
	getLineIndentColumn(lineNumber: number): number;
}

export class CoordinatesConverter implements ICoordinatesConverter {

	private readonly _lines: SplitLinesCollection;

	constructor(lines: SplitLinesCollection) {
		this._lines = lines;
	}

	// View -> Model conversion and related methods

	public convertViewPositionToModelPosition(viewPosition: Position): Position {
		return this._lines.convertViewPositionToModelPosition(viewPosition.lineNumber, viewPosition.column);
	}

	public convertViewRangeToModelRange(viewRange: Range): Range {
		return this._lines.convertViewRangeToModelRange(viewRange);
	}

	public validateViewPosition(viewPosition: Position, expectedModelPosition: Position): Position {
		return this._lines.validateViewPosition(viewPosition.lineNumber, viewPosition.column, expectedModelPosition);
	}

	public validateViewRange(viewRange: Range, expectedModelRange: Range): Range {
		return this._lines.validateViewRange(viewRange, expectedModelRange);
	}

	// Model -> View conversion and related methods

	public convertModelPositionToViewPosition(modelPosition: Position, affinity?: PositionAffinity): Position {
		return this._lines.convertModelPositionToViewPosition(modelPosition.lineNumber, modelPosition.column, affinity);
	}

	public convertModelRangeToViewRange(modelRange: Range, affinity?: PositionAffinity): Range {
		return this._lines.convertModelRangeToViewRange(modelRange, affinity);
	}

	public modelPositionIsVisible(modelPosition: Position): boolean {
		return this._lines.modelPositionIsVisible(modelPosition.lineNumber, modelPosition.column);
	}

	public getModelLineViewLineCount(modelLineNumber: number): number {
		return this._lines.getModelLineViewLineCount(modelLineNumber);
	}

	public getViewLineNumberOfModelPosition(modelLineNumber: number, modelColumn: number): number {
		return this._lines.getViewLineNumberOfModelPosition(modelLineNumber, modelColumn);
	}
}

const enum IndentGuideRepeatOption {
	BlockNone = 0,
	BlockSubsequent = 1,
	BlockAll = 2
}

export class SplitLinesCollection implements IViewModelLinesCollection {

	private readonly _editorId: number;
	private readonly model: ITextModel;
	private _validModelVersionId: number;

	private readonly _domLineBreaksComputerFactory: ILineBreaksComputerFactory;
	private readonly _monospaceLineBreaksComputerFactory: ILineBreaksComputerFactory;

	private fontInfo: FontInfo;
	private tabSize: number;
	private wrappingColumn: number;
	private wrappingIndent: WrappingIndent;
	private wrappingStrategy: 'simple' | 'advanced';

	private modelLineProjections!: IModelLineProjection[];

	/**
	 * Reflects the sum of the line counts of all .
	*/
	private projectedModelLineLineCounts!: ConstantTimePrefixSumComputer;

	private hiddenAreasIds!: string[];

	constructor(
		editorId: number,
		model: ITextModel,
		domLineBreaksComputerFactory: ILineBreaksComputerFactory,
		monospaceLineBreaksComputerFactory: ILineBreaksComputerFactory,
		fontInfo: FontInfo,
		tabSize: number,
		wrappingStrategy: 'simple' | 'advanced',
		wrappingColumn: number,
		wrappingIndent: WrappingIndent,
	) {
		this._editorId = editorId;
		this.model = model;
		this._validModelVersionId = -1;
		this._domLineBreaksComputerFactory = domLineBreaksComputerFactory;
		this._monospaceLineBreaksComputerFactory = monospaceLineBreaksComputerFactory;
		this.fontInfo = fontInfo;
		this.tabSize = tabSize;
		this.wrappingStrategy = wrappingStrategy;
		this.wrappingColumn = wrappingColumn;
		this.wrappingIndent = wrappingIndent;

		this._constructLines(/*resetHiddenAreas*/true, null);
	}

	public dispose(): void {
		this.hiddenAreasIds = this.model.deltaDecorations(this.hiddenAreasIds, []);
	}

	public createCoordinatesConverter(): ICoordinatesConverter {
		return new CoordinatesConverter(this);
	}

	private _constructLines(resetHiddenAreas: boolean, previousLineBreaks: ((LineBreakData | null)[]) | null): void {
		this.modelLineProjections = [];

		if (resetHiddenAreas) {
			this.hiddenAreasIds = [];
		}

		const linesContent = this.model.getLinesContent();
		const injectedTextDecorations = this.model.getInjectedTextDecorations(this._editorId);
		const lineCount = linesContent.length;
		const lineBreaksComputer = this.createLineBreaksComputer();

		const injectedTextQueue = new arrays.ArrayQueue(LineInjectedText.fromDecorations(injectedTextDecorations));
		for (let i = 0; i < lineCount; i++) {
			const lineInjectedText = injectedTextQueue.takeWhile(t => t.lineNumber === i + 1);
			lineBreaksComputer.addRequest(linesContent[i], lineInjectedText, previousLineBreaks ? previousLineBreaks[i] : null);
		}
		const linesBreaks = lineBreaksComputer.finalize();

		let values: number[] = [];

		let hiddenAreas = this.hiddenAreasIds.map((areaId) => this.model.getDecorationRange(areaId)!).sort(Range.compareRangesUsingStarts);
		let hiddenAreaStart = 1, hiddenAreaEnd = 0;
		let hiddenAreaIdx = -1;
		let nextLineNumberToUpdateHiddenArea = (hiddenAreaIdx + 1 < hiddenAreas.length) ? hiddenAreaEnd + 1 : lineCount + 2;

		for (let i = 0; i < lineCount; i++) {
			let lineNumber = i + 1;

			if (lineNumber === nextLineNumberToUpdateHiddenArea) {
				hiddenAreaIdx++;
				hiddenAreaStart = hiddenAreas[hiddenAreaIdx]!.startLineNumber;
				hiddenAreaEnd = hiddenAreas[hiddenAreaIdx]!.endLineNumber;
				nextLineNumberToUpdateHiddenArea = (hiddenAreaIdx + 1 < hiddenAreas.length) ? hiddenAreaEnd + 1 : lineCount + 2;
			}

			let isInHiddenArea = (lineNumber >= hiddenAreaStart && lineNumber <= hiddenAreaEnd);
			let line = createModelLineProjection(linesBreaks[i], !isInHiddenArea);
			values[i] = line.getViewLineCount();
			this.modelLineProjections[i] = line;
		}

		this._validModelVersionId = this.model.getVersionId();

		this.projectedModelLineLineCounts = new ConstantTimePrefixSumComputer(values);
	}

	public getHiddenAreas(): Range[] {
		return this.hiddenAreasIds.map((decId) => {
			return this.model.getDecorationRange(decId)!;
		});
	}

	private _reduceRanges(_ranges: Range[]): Range[] {
		if (_ranges.length === 0) {
			return [];
		}
		let ranges = _ranges.map(r => this.model.validateRange(r)).sort(Range.compareRangesUsingStarts);

		let result: Range[] = [];
		let currentRangeStart = ranges[0].startLineNumber;
		let currentRangeEnd = ranges[0].endLineNumber;

		for (let i = 1, len = ranges.length; i < len; i++) {
			let range = ranges[i];

			if (range.startLineNumber > currentRangeEnd + 1) {
				result.push(new Range(currentRangeStart, 1, currentRangeEnd, 1));
				currentRangeStart = range.startLineNumber;
				currentRangeEnd = range.endLineNumber;
			} else if (range.endLineNumber > currentRangeEnd) {
				currentRangeEnd = range.endLineNumber;
			}
		}
		result.push(new Range(currentRangeStart, 1, currentRangeEnd, 1));
		return result;
	}

	public setHiddenAreas(_ranges: Range[]): boolean {

		let newRanges = this._reduceRanges(_ranges);

		// BEGIN TODO@Martin: Please stop calling this method on each model change!
		let oldRanges = this.hiddenAreasIds.map((areaId) => this.model.getDecorationRange(areaId)!).sort(Range.compareRangesUsingStarts);

		if (newRanges.length === oldRanges.length) {
			let hasDifference = false;
			for (let i = 0; i < newRanges.length; i++) {
				if (!newRanges[i].equalsRange(oldRanges[i])) {
					hasDifference = true;
					break;
				}
			}
			if (!hasDifference) {
				return false;
			}
		}
		// END TODO@Martin: Please stop calling this method on each model change!

		let newDecorations: IModelDeltaDecoration[] = [];
		for (const newRange of newRanges) {
			newDecorations.push({
				range: newRange,
				options: ModelDecorationOptions.EMPTY
			});
		}

		this.hiddenAreasIds = this.model.deltaDecorations(this.hiddenAreasIds, newDecorations);

		let hiddenAreas = newRanges;
		let hiddenAreaStart = 1, hiddenAreaEnd = 0;
		let hiddenAreaIdx = -1;
		let nextLineNumberToUpdateHiddenArea = (hiddenAreaIdx + 1 < hiddenAreas.length) ? hiddenAreaEnd + 1 : this.modelLineProjections.length + 2;

		let hasVisibleLine = false;
		for (let i = 0; i < this.modelLineProjections.length; i++) {
			let lineNumber = i + 1;

			if (lineNumber === nextLineNumberToUpdateHiddenArea) {
				hiddenAreaIdx++;
				hiddenAreaStart = hiddenAreas[hiddenAreaIdx].startLineNumber;
				hiddenAreaEnd = hiddenAreas[hiddenAreaIdx].endLineNumber;
				nextLineNumberToUpdateHiddenArea = (hiddenAreaIdx + 1 < hiddenAreas.length) ? hiddenAreaEnd + 1 : this.modelLineProjections.length + 2;
			}

			let lineChanged = false;
			if (lineNumber >= hiddenAreaStart && lineNumber <= hiddenAreaEnd) {
				// Line should be hidden
				if (this.modelLineProjections[i].isVisible()) {
					this.modelLineProjections[i] = this.modelLineProjections[i].setVisible(false);
					lineChanged = true;
				}
			} else {
				hasVisibleLine = true;
				// Line should be visible
				if (!this.modelLineProjections[i].isVisible()) {
					this.modelLineProjections[i] = this.modelLineProjections[i].setVisible(true);
					lineChanged = true;
				}
			}
			if (lineChanged) {
				let newOutputLineCount = this.modelLineProjections[i].getViewLineCount();
				this.projectedModelLineLineCounts.setValue(i, newOutputLineCount);
			}
		}

		if (!hasVisibleLine) {
			// Cannot have everything be hidden => reveal everything!
			this.setHiddenAreas([]);
		}

		return true;
	}

	public modelPositionIsVisible(modelLineNumber: number, _modelColumn: number): boolean {
		if (modelLineNumber < 1 || modelLineNumber > this.modelLineProjections.length) {
			// invalid arguments
			return false;
		}
		return this.modelLineProjections[modelLineNumber - 1].isVisible();
	}

	public getModelLineViewLineCount(modelLineNumber: number): number {
		if (modelLineNumber < 1 || modelLineNumber > this.modelLineProjections.length) {
			// invalid arguments
			return 1;
		}
		return this.modelLineProjections[modelLineNumber - 1].getViewLineCount();
	}

	public setTabSize(newTabSize: number): boolean {
		if (this.tabSize === newTabSize) {
			return false;
		}
		this.tabSize = newTabSize;

		this._constructLines(/*resetHiddenAreas*/false, null);

		return true;
	}

	public setWrappingSettings(fontInfo: FontInfo, wrappingStrategy: 'simple' | 'advanced', wrappingColumn: number, wrappingIndent: WrappingIndent): boolean {
		const equalFontInfo = this.fontInfo.equals(fontInfo);
		const equalWrappingStrategy = (this.wrappingStrategy === wrappingStrategy);
		const equalWrappingColumn = (this.wrappingColumn === wrappingColumn);
		const equalWrappingIndent = (this.wrappingIndent === wrappingIndent);
		if (equalFontInfo && equalWrappingStrategy && equalWrappingColumn && equalWrappingIndent) {
			return false;
		}

		const onlyWrappingColumnChanged = (equalFontInfo && equalWrappingStrategy && !equalWrappingColumn && equalWrappingIndent);

		this.fontInfo = fontInfo;
		this.wrappingStrategy = wrappingStrategy;
		this.wrappingColumn = wrappingColumn;
		this.wrappingIndent = wrappingIndent;

		let previousLineBreaks: ((LineBreakData | null)[]) | null = null;
		if (onlyWrappingColumnChanged) {
			previousLineBreaks = [];
			for (let i = 0, len = this.modelLineProjections.length; i < len; i++) {
				previousLineBreaks[i] = this.modelLineProjections[i].getLineBreakData();
			}
		}

		this._constructLines(/*resetHiddenAreas*/false, previousLineBreaks);

		return true;
	}

	public createLineBreaksComputer(): ILineBreaksComputer {
		const lineBreaksComputerFactory = (
			this.wrappingStrategy === 'advanced'
				? this._domLineBreaksComputerFactory
				: this._monospaceLineBreaksComputerFactory
		);
		return lineBreaksComputerFactory.createLineBreaksComputer(this.fontInfo, this.tabSize, this.wrappingColumn, this.wrappingIndent);
	}

	public onModelFlushed(): void {
		this._constructLines(/*resetHiddenAreas*/true, null);
	}

	public onModelLinesDeleted(versionId: number | null, fromLineNumber: number, toLineNumber: number): viewEvents.ViewLinesDeletedEvent | null {
		if (!versionId || versionId <= this._validModelVersionId) {
			// Here we check for versionId in case the lines were reconstructed in the meantime.
			// We don't want to apply stale change events on top of a newer read model state.
			return null;
		}

		let outputFromLineNumber = (fromLineNumber === 1 ? 1 : this.projectedModelLineLineCounts.getPrefixSum(fromLineNumber - 2) + 1);
		let outputToLineNumber = this.projectedModelLineLineCounts.getPrefixSum(toLineNumber - 1);

		this.modelLineProjections.splice(fromLineNumber - 1, toLineNumber - fromLineNumber + 1);
		this.projectedModelLineLineCounts.removeValues(fromLineNumber - 1, toLineNumber - fromLineNumber + 1);

		return new viewEvents.ViewLinesDeletedEvent(outputFromLineNumber, outputToLineNumber);
	}

	public onModelLinesInserted(versionId: number | null, fromLineNumber: number, _toLineNumber: number, lineBreaks: (LineBreakData | null)[]): viewEvents.ViewLinesInsertedEvent | null {
		if (!versionId || versionId <= this._validModelVersionId) {
			// Here we check for versionId in case the lines were reconstructed in the meantime.
			// We don't want to apply stale change events on top of a newer read model state.
			return null;
		}

		// cannot use this.getHiddenAreas() because those decorations have already seen the effect of this model change
		const isInHiddenArea = (fromLineNumber > 2 && !this.modelLineProjections[fromLineNumber - 2].isVisible());

		let outputFromLineNumber = (fromLineNumber === 1 ? 1 : this.projectedModelLineLineCounts.getPrefixSum(fromLineNumber - 2) + 1);

		let totalOutputLineCount = 0;
		let insertLines: IModelLineProjection[] = [];
		let insertPrefixSumValues: number[] = [];

		for (let i = 0, len = lineBreaks.length; i < len; i++) {
			let line = createModelLineProjection(lineBreaks[i], !isInHiddenArea);
			insertLines.push(line);

			let outputLineCount = line.getViewLineCount();
			totalOutputLineCount += outputLineCount;
			insertPrefixSumValues[i] = outputLineCount;
		}

		// TODO@Alex: use arrays.arrayInsert
		this.modelLineProjections = this.modelLineProjections.slice(0, fromLineNumber - 1).concat(insertLines).concat(this.modelLineProjections.slice(fromLineNumber - 1));

		this.projectedModelLineLineCounts.insertValues(fromLineNumber - 1, insertPrefixSumValues);

		return new viewEvents.ViewLinesInsertedEvent(outputFromLineNumber, outputFromLineNumber + totalOutputLineCount - 1);
	}

	public onModelLineChanged(versionId: number | null, lineNumber: number, lineBreakData: LineBreakData | null): [boolean, viewEvents.ViewLinesChangedEvent | null, viewEvents.ViewLinesInsertedEvent | null, viewEvents.ViewLinesDeletedEvent | null] {
		if (versionId !== null && versionId <= this._validModelVersionId) {
			// Here we check for versionId in case the lines were reconstructed in the meantime.
			// We don't want to apply stale change events on top of a newer read model state.
			return [false, null, null, null];
		}

		let lineIndex = lineNumber - 1;

		let oldOutputLineCount = this.modelLineProjections[lineIndex].getViewLineCount();
		let isVisible = this.modelLineProjections[lineIndex].isVisible();
		let line = createModelLineProjection(lineBreakData, isVisible);
		this.modelLineProjections[lineIndex] = line;
		let newOutputLineCount = this.modelLineProjections[lineIndex].getViewLineCount();

		let lineMappingChanged = false;
		let changeFrom = 0;
		let changeTo = -1;
		let insertFrom = 0;
		let insertTo = -1;
		let deleteFrom = 0;
		let deleteTo = -1;

		if (oldOutputLineCount > newOutputLineCount) {
			changeFrom = (lineNumber === 1 ? 1 : this.projectedModelLineLineCounts.getPrefixSum(lineNumber - 2) + 1);
			changeTo = changeFrom + newOutputLineCount - 1;
			deleteFrom = changeTo + 1;
			deleteTo = deleteFrom + (oldOutputLineCount - newOutputLineCount) - 1;
			lineMappingChanged = true;
		} else if (oldOutputLineCount < newOutputLineCount) {
			changeFrom = (lineNumber === 1 ? 1 : this.projectedModelLineLineCounts.getPrefixSum(lineNumber - 2) + 1);
			changeTo = changeFrom + oldOutputLineCount - 1;
			insertFrom = changeTo + 1;
			insertTo = insertFrom + (newOutputLineCount - oldOutputLineCount) - 1;
			lineMappingChanged = true;
		} else {
			changeFrom = (lineNumber === 1 ? 1 : this.projectedModelLineLineCounts.getPrefixSum(lineNumber - 2) + 1);
			changeTo = changeFrom + newOutputLineCount - 1;
		}

		this.projectedModelLineLineCounts.setValue(lineIndex, newOutputLineCount);

		const viewLinesChangedEvent = (changeFrom <= changeTo ? new viewEvents.ViewLinesChangedEvent(changeFrom, changeTo) : null);
		const viewLinesInsertedEvent = (insertFrom <= insertTo ? new viewEvents.ViewLinesInsertedEvent(insertFrom, insertTo) : null);
		const viewLinesDeletedEvent = (deleteFrom <= deleteTo ? new viewEvents.ViewLinesDeletedEvent(deleteFrom, deleteTo) : null);

		return [lineMappingChanged, viewLinesChangedEvent, viewLinesInsertedEvent, viewLinesDeletedEvent];
	}

	public acceptVersionId(versionId: number): void {
		this._validModelVersionId = versionId;
		if (this.modelLineProjections.length === 1 && !this.modelLineProjections[0].isVisible()) {
			// At least one line must be visible => reset hidden areas
			this.setHiddenAreas([]);
		}
	}

	public getViewLineCount(): number {
		return this.projectedModelLineLineCounts.getTotalSum();
	}

	private _toValidViewLineNumber(viewLineNumber: number): number {
		if (viewLineNumber < 1) {
			return 1;
		}
		const viewLineCount = this.getViewLineCount();
		if (viewLineNumber > viewLineCount) {
			return viewLineCount;
		}
		return viewLineNumber | 0;
	}

	public getActiveIndentGuide(viewLineNumber: number, minLineNumber: number, maxLineNumber: number): IActiveIndentGuideInfo {
		viewLineNumber = this._toValidViewLineNumber(viewLineNumber);
		minLineNumber = this._toValidViewLineNumber(minLineNumber);
		maxLineNumber = this._toValidViewLineNumber(maxLineNumber);

		const modelPosition = this.convertViewPositionToModelPosition(viewLineNumber, this.getViewLineMinColumn(viewLineNumber));
		const modelMinPosition = this.convertViewPositionToModelPosition(minLineNumber, this.getViewLineMinColumn(minLineNumber));
		const modelMaxPosition = this.convertViewPositionToModelPosition(maxLineNumber, this.getViewLineMinColumn(maxLineNumber));
		const result = this.model.getActiveIndentGuide(modelPosition.lineNumber, modelMinPosition.lineNumber, modelMaxPosition.lineNumber);

		const viewStartPosition = this.convertModelPositionToViewPosition(result.startLineNumber, 1);
		const viewEndPosition = this.convertModelPositionToViewPosition(result.endLineNumber, this.model.getLineMaxColumn(result.endLineNumber));
		return {
			startLineNumber: viewStartPosition.lineNumber,
			endLineNumber: viewEndPosition.lineNumber,
			indent: result.indent
		};
	}

	// #region ViewLineInfo

	private getViewLineInfo(viewLineNumber: number): ViewLineInfo {
		viewLineNumber = this._toValidViewLineNumber(viewLineNumber);
		let r = this.projectedModelLineLineCounts.getIndexOf(viewLineNumber - 1);
		let lineIndex = r.index;
		let remainder = r.remainder;
		return new ViewLineInfo(lineIndex + 1, remainder);
	}

	private getMinColumnOfViewLine(viewLineInfo: ViewLineInfo): number {
		return this.modelLineProjections[viewLineInfo.modelLineNumber - 1].getViewLineMinColumn(
			this.model,
			viewLineInfo.modelLineNumber,
			viewLineInfo.modelLineWrappedLineIdx
		);
	}

	private getModelStartPositionOfViewLine(viewLineInfo: ViewLineInfo): Position {
		const line = this.modelLineProjections[viewLineInfo.modelLineNumber - 1];
		const minViewColumn = line.getViewLineMinColumn(
			this.model,
			viewLineInfo.modelLineNumber,
			viewLineInfo.modelLineWrappedLineIdx
		);
		const column = line.getModelColumnOfViewPosition(
			viewLineInfo.modelLineWrappedLineIdx,
			minViewColumn
		);
		return new Position(viewLineInfo.modelLineNumber, column);
	}

	private getModelEndPositionOfViewLine(viewLineInfo: ViewLineInfo): Position {
		const line = this.modelLineProjections[viewLineInfo.modelLineNumber - 1];
		const maxViewColumn = line.getViewLineMaxColumn(
			this.model,
			viewLineInfo.modelLineNumber,
			viewLineInfo.modelLineWrappedLineIdx
		);
		const column = line.getModelColumnOfViewPosition(
			viewLineInfo.modelLineWrappedLineIdx,
			maxViewColumn
		);
		return new Position(viewLineInfo.modelLineNumber, column);
	}

	private getViewLineInfosGroupedByModelRanges(viewStartLineNumber: number, viewEndLineNumber: number): ViewLineInfoGroupedByModelRange[] {
		const startViewLine = this.getViewLineInfo(viewStartLineNumber);
		const endViewLine = this.getViewLineInfo(viewEndLineNumber);

		const result = new Array<ViewLineInfoGroupedByModelRange>();
		let lastVisibleModelPos: Position | null = this.getModelStartPositionOfViewLine(startViewLine);
		let viewLines = new Array<ViewLineInfo>();

		for (let curModelLine = startViewLine.modelLineNumber; curModelLine <= endViewLine.modelLineNumber; curModelLine++) {
			const line = this.modelLineProjections[curModelLine - 1];

			if (line.isVisible()) {
				let startOffset =
					curModelLine === startViewLine.modelLineNumber
						? startViewLine.modelLineWrappedLineIdx
						: 0;

				let endOffset =
					curModelLine === endViewLine.modelLineNumber
						? endViewLine.modelLineWrappedLineIdx + 1
						: line.getViewLineCount();

				for (let i = startOffset; i < endOffset; i++) {
					viewLines.push(new ViewLineInfo(curModelLine, i));
				}
			}

			if (!line.isVisible() && lastVisibleModelPos) {
				const lastVisibleModelPos2 = new Position(curModelLine - 1, this.model.getLineMaxColumn(curModelLine - 1) + 1);

				const modelRange = Range.fromPositions(lastVisibleModelPos, lastVisibleModelPos2);
				result.push(new ViewLineInfoGroupedByModelRange(modelRange, viewLines));
				viewLines = [];

				lastVisibleModelPos = null;
			} else if (line.isVisible() && !lastVisibleModelPos) {
				lastVisibleModelPos = new Position(curModelLine, 1);
			}
		}

		if (lastVisibleModelPos) {
			const modelRange = Range.fromPositions(lastVisibleModelPos, this.getModelEndPositionOfViewLine(endViewLine));
			result.push(new ViewLineInfoGroupedByModelRange(modelRange, viewLines));
		}

		return result;
	}

	// #endregion

	public getViewLinesBracketGuides(viewStartLineNumber: number, viewEndLineNumber: number, activeViewPosition: IPosition | null, options: BracketGuideOptions): IndentGuide[][] {
		const modelActivePosition = activeViewPosition ? this.convertViewPositionToModelPosition(activeViewPosition.lineNumber, activeViewPosition.column) : null;
		const resultPerViewLine: IndentGuide[][] = [];

		for (const group of this.getViewLineInfosGroupedByModelRanges(viewStartLineNumber, viewEndLineNumber)) {
			const modelRangeStartLineNumber = group.modelRange.startLineNumber;

			const bracketGuidesPerModelLine = this.model.getLinesBracketGuides(
				modelRangeStartLineNumber,
				group.modelRange.endLineNumber,
				modelActivePosition,
				options
			);

			for (const viewLineInfo of group.viewLines) {
				if (viewLineInfo.isWrappedLineContinuation && this.getMinColumnOfViewLine(viewLineInfo) === 1) {
					// Don't add indent guides when the wrapped line continuation has no wrapping-indentation.
					resultPerViewLine.push([]);
				} else {
					let bracketGuides = bracketGuidesPerModelLine[viewLineInfo.modelLineNumber - modelRangeStartLineNumber];

					// visibleColumns stay as they are (this is a bug and needs to be fixed, but it is not a regression)
					// model-columns must be converted to view-model columns.
					bracketGuides = bracketGuides.map(g => g.horizontalLine ?
						new IndentGuide(g.visibleColumn, g.className,
							new IndentGuideHorizontalLine(g.horizontalLine.top,
								this.convertModelPositionToViewPosition(viewLineInfo.modelLineNumber, g.horizontalLine.endColumn).column
							)
						) : g);
					resultPerViewLine.push(bracketGuides);
				}
			}
		}

		return resultPerViewLine;
	}

	public getViewLinesIndentGuides(viewStartLineNumber: number, viewEndLineNumber: number): number[] {
		// TODO: Use the same code as in `getViewLinesBracketGuides`.
		// Future TODO: Merge with `getViewLinesBracketGuides`.
		// However, this requires more refactoring of indent guides.
		viewStartLineNumber = this._toValidViewLineNumber(viewStartLineNumber);
		viewEndLineNumber = this._toValidViewLineNumber(viewEndLineNumber);

		const modelStart = this.convertViewPositionToModelPosition(viewStartLineNumber, this.getViewLineMinColumn(viewStartLineNumber));
		const modelEnd = this.convertViewPositionToModelPosition(viewEndLineNumber, this.getViewLineMaxColumn(viewEndLineNumber));

		let result: number[] = [];
		let resultRepeatCount: number[] = [];
		let resultRepeatOption: IndentGuideRepeatOption[] = [];
		const modelStartLineIndex = modelStart.lineNumber - 1;
		const modelEndLineIndex = modelEnd.lineNumber - 1;

		let reqStart: Position | null = null;
		for (let modelLineIndex = modelStartLineIndex; modelLineIndex <= modelEndLineIndex; modelLineIndex++) {
			const line = this.modelLineProjections[modelLineIndex];
			if (line.isVisible()) {
				let viewLineStartIndex = line.getViewLineNumberOfModelPosition(0, modelLineIndex === modelStartLineIndex ? modelStart.column : 1);
				let viewLineEndIndex = line.getViewLineNumberOfModelPosition(0, this.model.getLineMaxColumn(modelLineIndex + 1));
				let count = viewLineEndIndex - viewLineStartIndex + 1;
				let option = IndentGuideRepeatOption.BlockNone;
				if (count > 1 && line.getViewLineMinColumn(this.model, modelLineIndex + 1, viewLineEndIndex) === 1) {
					// wrapped lines should block indent guides
					option = (viewLineStartIndex === 0 ? IndentGuideRepeatOption.BlockSubsequent : IndentGuideRepeatOption.BlockAll);
				}
				resultRepeatCount.push(count);
				resultRepeatOption.push(option);
				// merge into previous request
				if (reqStart === null) {
					reqStart = new Position(modelLineIndex + 1, 0);
				}
			} else {
				// hit invisible line => flush request
				if (reqStart !== null) {
					result = result.concat(this.model.getLinesIndentGuides(reqStart.lineNumber, modelLineIndex));
					reqStart = null;
				}
			}
		}

		if (reqStart !== null) {
			result = result.concat(this.model.getLinesIndentGuides(reqStart.lineNumber, modelEnd.lineNumber));
			reqStart = null;
		}

		const viewLineCount = viewEndLineNumber - viewStartLineNumber + 1;
		let viewIndents = new Array<number>(viewLineCount);
		let currIndex = 0;
		for (let i = 0, len = result.length; i < len; i++) {
			let value = result[i];
			let count = Math.min(viewLineCount - currIndex, resultRepeatCount[i]);
			let option = resultRepeatOption[i];
			let blockAtIndex: number;
			if (option === IndentGuideRepeatOption.BlockAll) {
				blockAtIndex = 0;
			} else if (option === IndentGuideRepeatOption.BlockSubsequent) {
				blockAtIndex = 1;
			} else {
				blockAtIndex = count;
			}
			for (let j = 0; j < count; j++) {
				if (j === blockAtIndex) {
					value = 0;
				}
				viewIndents[currIndex++] = value;
			}
		}
		return viewIndents;
	}

	public getViewLineContent(viewLineNumber: number): string {
		const info = this.getViewLineInfo(viewLineNumber);
		return this.modelLineProjections[info.modelLineNumber - 1].getViewLineContent(this.model, info.modelLineNumber, info.modelLineWrappedLineIdx);
	}

	public getViewLineLength(viewLineNumber: number): number {
		const info = this.getViewLineInfo(viewLineNumber);
		return this.modelLineProjections[info.modelLineNumber - 1].getViewLineLength(this.model, info.modelLineNumber, info.modelLineWrappedLineIdx);
	}

	public getViewLineMinColumn(viewLineNumber: number): number {
		const info = this.getViewLineInfo(viewLineNumber);
		return this.modelLineProjections[info.modelLineNumber - 1].getViewLineMinColumn(this.model, info.modelLineNumber, info.modelLineWrappedLineIdx);
	}

	public getViewLineMaxColumn(viewLineNumber: number): number {
		const info = this.getViewLineInfo(viewLineNumber);
		return this.modelLineProjections[info.modelLineNumber - 1].getViewLineMaxColumn(this.model, info.modelLineNumber, info.modelLineWrappedLineIdx);
	}

	public getViewLineData(viewLineNumber: number): ViewLineData {
		const info = this.getViewLineInfo(viewLineNumber);
		return this.modelLineProjections[info.modelLineNumber - 1].getViewLineData(this.model, info.modelLineNumber, info.modelLineWrappedLineIdx);
	}

	public getViewLinesData(viewStartLineNumber: number, viewEndLineNumber: number, needed: boolean[]): ViewLineData[] {

		viewStartLineNumber = this._toValidViewLineNumber(viewStartLineNumber);
		viewEndLineNumber = this._toValidViewLineNumber(viewEndLineNumber);

		let start = this.projectedModelLineLineCounts.getIndexOf(viewStartLineNumber - 1);
		let viewLineNumber = viewStartLineNumber;
		let startModelLineIndex = start.index;
		let startRemainder = start.remainder;

		let result: ViewLineData[] = [];
		for (let modelLineIndex = startModelLineIndex, len = this.model.getLineCount(); modelLineIndex < len; modelLineIndex++) {
			let line = this.modelLineProjections[modelLineIndex];
			if (!line.isVisible()) {
				continue;
			}
			let fromViewLineIndex = (modelLineIndex === startModelLineIndex ? startRemainder : 0);
			let remainingViewLineCount = line.getViewLineCount() - fromViewLineIndex;

			let lastLine = false;
			if (viewLineNumber + remainingViewLineCount > viewEndLineNumber) {
				lastLine = true;
				remainingViewLineCount = viewEndLineNumber - viewLineNumber + 1;
			}
			let toViewLineIndex = fromViewLineIndex + remainingViewLineCount;

			line.getViewLinesData(this.model, modelLineIndex + 1, fromViewLineIndex, toViewLineIndex, viewLineNumber - viewStartLineNumber, needed, result);

			viewLineNumber += remainingViewLineCount;

			if (lastLine) {
				break;
			}
		}

		return result;
	}

	public validateViewPosition(viewLineNumber: number, viewColumn: number, expectedModelPosition: Position): Position {
		viewLineNumber = this._toValidViewLineNumber(viewLineNumber);

		let r = this.projectedModelLineLineCounts.getIndexOf(viewLineNumber - 1);
		let lineIndex = r.index;
		let remainder = r.remainder;

		let line = this.modelLineProjections[lineIndex];

		let minColumn = line.getViewLineMinColumn(this.model, lineIndex + 1, remainder);
		let maxColumn = line.getViewLineMaxColumn(this.model, lineIndex + 1, remainder);
		if (viewColumn < minColumn) {
			viewColumn = minColumn;
		}
		if (viewColumn > maxColumn) {
			viewColumn = maxColumn;
		}

		let computedModelColumn = line.getModelColumnOfViewPosition(remainder, viewColumn);
		let computedModelPosition = this.model.validatePosition(new Position(lineIndex + 1, computedModelColumn));

		if (computedModelPosition.equals(expectedModelPosition)) {
			return new Position(viewLineNumber, viewColumn);
		}

		return this.convertModelPositionToViewPosition(expectedModelPosition.lineNumber, expectedModelPosition.column);
	}

	public validateViewRange(viewRange: Range, expectedModelRange: Range): Range {
		const validViewStart = this.validateViewPosition(viewRange.startLineNumber, viewRange.startColumn, expectedModelRange.getStartPosition());
		const validViewEnd = this.validateViewPosition(viewRange.endLineNumber, viewRange.endColumn, expectedModelRange.getEndPosition());
		return new Range(validViewStart.lineNumber, validViewStart.column, validViewEnd.lineNumber, validViewEnd.column);
	}

	public convertViewPositionToModelPosition(viewLineNumber: number, viewColumn: number): Position {
		const info = this.getViewLineInfo(viewLineNumber);

		let inputColumn = this.modelLineProjections[info.modelLineNumber - 1].getModelColumnOfViewPosition(info.modelLineWrappedLineIdx, viewColumn);
		// console.log('out -> in ' + viewLineNumber + ',' + viewColumn + ' ===> ' + (lineIndex+1) + ',' + inputColumn);
		return this.model.validatePosition(new Position(info.modelLineNumber, inputColumn));
	}

	public convertViewRangeToModelRange(viewRange: Range): Range {
		const start = this.convertViewPositionToModelPosition(viewRange.startLineNumber, viewRange.startColumn);
		const end = this.convertViewPositionToModelPosition(viewRange.endLineNumber, viewRange.endColumn);
		return new Range(start.lineNumber, start.column, end.lineNumber, end.column);
	}

	public convertModelPositionToViewPosition(_modelLineNumber: number, _modelColumn: number, affinity: PositionAffinity = PositionAffinity.None): Position {

		const validPosition = this.model.validatePosition(new Position(_modelLineNumber, _modelColumn));
		const inputLineNumber = validPosition.lineNumber;
		const inputColumn = validPosition.column;

		let lineIndex = inputLineNumber - 1, lineIndexChanged = false;
		while (lineIndex > 0 && !this.modelLineProjections[lineIndex].isVisible()) {
			lineIndex--;
			lineIndexChanged = true;
		}
		if (lineIndex === 0 && !this.modelLineProjections[lineIndex].isVisible()) {
			// Could not reach a real line
			// console.log('in -> out ' + inputLineNumber + ',' + inputColumn + ' ===> ' + 1 + ',' + 1);
			return new Position(1, 1);
		}
		const deltaLineNumber = 1 + (lineIndex === 0 ? 0 : this.projectedModelLineLineCounts.getPrefixSum(lineIndex - 1));

		let r: Position;
		if (lineIndexChanged) {
			r = this.modelLineProjections[lineIndex].getViewPositionOfModelPosition(deltaLineNumber, this.model.getLineMaxColumn(lineIndex + 1), affinity);
		} else {
			r = this.modelLineProjections[inputLineNumber - 1].getViewPositionOfModelPosition(deltaLineNumber, inputColumn, affinity);
		}

		// console.log('in -> out ' + inputLineNumber + ',' + inputColumn + ' ===> ' + r.lineNumber + ',' + r);
		return r;
	}

	/**
	 * @param affinity The affinity in case of an empty range. Has no effect for non-empty ranges.
	*/
	public convertModelRangeToViewRange(modelRange: Range, affinity: PositionAffinity = PositionAffinity.Left): Range {
		if (modelRange.isEmpty()) {
			const start = this.convertModelPositionToViewPosition(modelRange.startLineNumber, modelRange.startColumn, affinity);
			return Range.fromPositions(start);
		} else {
			const start = this.convertModelPositionToViewPosition(modelRange.startLineNumber, modelRange.startColumn, PositionAffinity.Right);
			const end = this.convertModelPositionToViewPosition(modelRange.endLineNumber, modelRange.endColumn, PositionAffinity.Left);
			return new Range(start.lineNumber, start.column, end.lineNumber, end.column);
		}
	}

	public getViewLineNumberOfModelPosition(modelLineNumber: number, modelColumn: number): number {
		let lineIndex = modelLineNumber - 1;
		if (this.modelLineProjections[lineIndex].isVisible()) {
			// this model line is visible
			const deltaLineNumber = 1 + (lineIndex === 0 ? 0 : this.projectedModelLineLineCounts.getPrefixSum(lineIndex - 1));
			return this.modelLineProjections[lineIndex].getViewLineNumberOfModelPosition(deltaLineNumber, modelColumn);
		}

		// this model line is not visible
		while (lineIndex > 0 && !this.modelLineProjections[lineIndex].isVisible()) {
			lineIndex--;
		}
		if (lineIndex === 0 && !this.modelLineProjections[lineIndex].isVisible()) {
			// Could not reach a real line
			return 1;
		}
		const deltaLineNumber = 1 + (lineIndex === 0 ? 0 : this.projectedModelLineLineCounts.getPrefixSum(lineIndex - 1));
		return this.modelLineProjections[lineIndex].getViewLineNumberOfModelPosition(deltaLineNumber, this.model.getLineMaxColumn(lineIndex + 1));
	}

	public getDecorationsInRange(range: Range, ownerId: number, filterOutValidation: boolean): IModelDecoration[] {
		const modelStart = this.convertViewPositionToModelPosition(range.startLineNumber, range.startColumn);
		const modelEnd = this.convertViewPositionToModelPosition(range.endLineNumber, range.endColumn);

		if (modelEnd.lineNumber - modelStart.lineNumber <= range.endLineNumber - range.startLineNumber) {
			// most likely there are no hidden lines => fast path
			// fetch decorations from column 1 to cover the case of wrapped lines that have whole line decorations at column 1
			return this.model.getDecorationsInRange(new Range(modelStart.lineNumber, 1, modelEnd.lineNumber, modelEnd.column), ownerId, filterOutValidation);
		}

		let result: IModelDecoration[] = [];
		const modelStartLineIndex = modelStart.lineNumber - 1;
		const modelEndLineIndex = modelEnd.lineNumber - 1;

		let reqStart: Position | null = null;
		for (let modelLineIndex = modelStartLineIndex; modelLineIndex <= modelEndLineIndex; modelLineIndex++) {
			const line = this.modelLineProjections[modelLineIndex];
			if (line.isVisible()) {
				// merge into previous request
				if (reqStart === null) {
					reqStart = new Position(modelLineIndex + 1, modelLineIndex === modelStartLineIndex ? modelStart.column : 1);
				}
			} else {
				// hit invisible line => flush request
				if (reqStart !== null) {
					const maxLineColumn = this.model.getLineMaxColumn(modelLineIndex);
					result = result.concat(this.model.getDecorationsInRange(new Range(reqStart.lineNumber, reqStart.column, modelLineIndex, maxLineColumn), ownerId, filterOutValidation));
					reqStart = null;
				}
			}
		}

		if (reqStart !== null) {
			result = result.concat(this.model.getDecorationsInRange(new Range(reqStart.lineNumber, reqStart.column, modelEnd.lineNumber, modelEnd.column), ownerId, filterOutValidation));
			reqStart = null;
		}

		result.sort((a, b) => {
			const res = Range.compareRangesUsingStarts(a.range, b.range);
			if (res === 0) {
				if (a.id < b.id) {
					return -1;
				}
				if (a.id > b.id) {
					return 1;
				}
				return 0;
			}
			return res;
		});

		// Eliminate duplicate decorations that might have intersected our visible ranges multiple times
		let finalResult: IModelDecoration[] = [], finalResultLen = 0;
		let prevDecId: string | null = null;
		for (const dec of result) {
			const decId = dec.id;
			if (prevDecId === decId) {
				// skip
				continue;
			}
			prevDecId = decId;
			finalResult[finalResultLen++] = dec;
		}

		return finalResult;
	}

	public getInjectedTextAt(position: Position): InjectedText | null {
		const info = this.getViewLineInfo(position.lineNumber);
		return this.modelLineProjections[info.modelLineNumber - 1].getInjectedTextAt(info.modelLineWrappedLineIdx, position.column);
	}

	normalizePosition(position: Position, affinity: PositionAffinity): Position {
		const info = this.getViewLineInfo(position.lineNumber);
		return this.modelLineProjections[info.modelLineNumber - 1].normalizePosition(this.model, info.modelLineNumber, info.modelLineWrappedLineIdx, position, affinity);
	}

	public getLineIndentColumn(lineNumber: number): number {
		const info = this.getViewLineInfo(lineNumber);
		if (info.modelLineWrappedLineIdx === 0) {
			return this.model.getLineIndentColumn(info.modelLineNumber);
		}

		// wrapped lines have no indentation.
		// We deliberately don't handle the case that indentation is wrapped
		// to avoid two view lines reporting indentation for the very same model line.
		return 0;
	}
}

/**
 * Represents a view line. Can be used to efficiently query more information about it.
 */
class ViewLineInfo {
	public get isWrappedLineContinuation(): boolean {
		return this.modelLineWrappedLineIdx > 0;
	}

	constructor(
		public readonly modelLineNumber: number,
		public readonly modelLineWrappedLineIdx: number,
	) { }
}

/**
 * A list of view lines that have a contiguous span in the model.
*/
class ViewLineInfoGroupedByModelRange {
	constructor(public readonly modelRange: Range, public readonly viewLines: ViewLineInfo[]) {
	}
}

/**
 * This projection does not change the model line.
*/
class IdentityModelLineProjection implements IModelLineProjection {

	public static readonly INSTANCE = new IdentityModelLineProjection();

	private constructor() { }

	public isVisible(): boolean {
		return true;
	}

	public setVisible(isVisible: boolean): IModelLineProjection {
		if (isVisible) {
			return this;
		}
		return HiddenModelLineProjection.INSTANCE;
	}

	public getLineBreakData(): LineBreakData | null {
		return null;
	}

	public getViewLineCount(): number {
		return 1;
	}

	public getViewLineContent(model: ISimpleModel, modelLineNumber: number, _outputLineIndex: number): string {
		return model.getLineContent(modelLineNumber);
	}

	public getViewLineLength(model: ISimpleModel, modelLineNumber: number, _outputLineIndex: number): number {
		return model.getLineLength(modelLineNumber);
	}

	public getViewLineMinColumn(model: ISimpleModel, modelLineNumber: number, _outputLineIndex: number): number {
		return model.getLineMinColumn(modelLineNumber);
	}

	public getViewLineMaxColumn(model: ISimpleModel, modelLineNumber: number, _outputLineIndex: number): number {
		return model.getLineMaxColumn(modelLineNumber);
	}

	public getViewLineData(model: ISimpleModel, modelLineNumber: number, _outputLineIndex: number): ViewLineData {
		let lineTokens = model.getLineTokens(modelLineNumber);
		let lineContent = lineTokens.getLineContent();
		return new ViewLineData(
			lineContent,
			false,
			1,
			lineContent.length + 1,
			0,
			lineTokens.inflate(),
			null
		);
	}

	public getViewLinesData(model: ISimpleModel, modelLineNumber: number, _fromOuputLineIndex: number, _toOutputLineIndex: number, globalStartIndex: number, needed: boolean[], result: Array<ViewLineData | null>): void {
		if (!needed[globalStartIndex]) {
			result[globalStartIndex] = null;
			return;
		}
		result[globalStartIndex] = this.getViewLineData(model, modelLineNumber, 0);
	}

	public getModelColumnOfViewPosition(_outputLineIndex: number, outputColumn: number): number {
		return outputColumn;
	}

	public getViewPositionOfModelPosition(deltaLineNumber: number, inputColumn: number): Position {
		return new Position(deltaLineNumber, inputColumn);
	}

	public getViewLineNumberOfModelPosition(deltaLineNumber: number, _inputColumn: number): number {
		return deltaLineNumber;
	}

	public normalizePosition(model: ISimpleModel, modelLineNumber: number, outputLineIndex: number, outputPosition: Position, affinity: PositionAffinity): Position {
		return outputPosition;
	}

	public getInjectedTextAt(_outputLineIndex: number, _outputColumn: number): InjectedText | null {
		return null;
	}
}

/**
 * This projection hides the model line.
 */
class HiddenModelLineProjection implements IModelLineProjection {

	public static readonly INSTANCE = new HiddenModelLineProjection();

	private constructor() { }

	public isVisible(): boolean {
		return false;
	}

	public setVisible(isVisible: boolean): IModelLineProjection {
		if (!isVisible) {
			return this;
		}
		return IdentityModelLineProjection.INSTANCE;
	}

	public getLineBreakData(): LineBreakData | null {
		return null;
	}

	public getViewLineCount(): number {
		return 0;
	}

	public getViewLineContent(_model: ISimpleModel, _modelLineNumber: number, _outputLineIndex: number): string {
		throw new Error('Not supported');
	}

	public getViewLineLength(_model: ISimpleModel, _modelLineNumber: number, _outputLineIndex: number): number {
		throw new Error('Not supported');
	}

	public getViewLineMinColumn(_model: ISimpleModel, _modelLineNumber: number, _outputLineIndex: number): number {
		throw new Error('Not supported');
	}

	public getViewLineMaxColumn(_model: ISimpleModel, _modelLineNumber: number, _outputLineIndex: number): number {
		throw new Error('Not supported');
	}

	public getViewLineData(_model: ISimpleModel, _modelLineNumber: number, _outputLineIndex: number): ViewLineData {
		throw new Error('Not supported');
	}

	public getViewLinesData(_model: ISimpleModel, _modelLineNumber: number, _fromOuputLineIndex: number, _toOutputLineIndex: number, _globalStartIndex: number, _needed: boolean[], _result: ViewLineData[]): void {
		throw new Error('Not supported');
	}

	public getModelColumnOfViewPosition(_outputLineIndex: number, _outputColumn: number): number {
		throw new Error('Not supported');
	}

	public getViewPositionOfModelPosition(_deltaLineNumber: number, _inputColumn: number): Position {
		throw new Error('Not supported');
	}

	public getViewLineNumberOfModelPosition(_deltaLineNumber: number, _inputColumn: number): number {
		throw new Error('Not supported');
	}

	public normalizePosition(model: ISimpleModel, modelLineNumber: number, outputLineIndex: number, outputPosition: Position, affinity: PositionAffinity): Position {
		throw new Error('Not supported');
	}

	public getInjectedTextAt(_outputLineIndex: number, _outputColumn: number): InjectedText | null {
		throw new Error('Not supported');
	}
}

/**
 * This projection is used to
 * * wrap model lines
 * * inject text
 */
export class ModelLineProjection implements IModelLineProjection {

	private readonly _lineBreakData: LineBreakData;
	private _isVisible: boolean;

	constructor(lineBreakData: LineBreakData, isVisible: boolean) {
		this._lineBreakData = lineBreakData;
		this._isVisible = isVisible;
	}

	public isVisible(): boolean {
		return this._isVisible;
	}

	public setVisible(isVisible: boolean): IModelLineProjection {
		this._isVisible = isVisible;
		return this;
	}

	public getLineBreakData(): LineBreakData | null {
		return this._lineBreakData;
	}

	public getViewLineCount(): number {
		if (!this._isVisible) {
			return 0;
		}
		return this._lineBreakData.breakOffsets.length;
	}

	private getInputStartOffsetOfOutputLineIndex(outputLineIndex: number): number {
		return this._lineBreakData.getInputOffsetOfOutputPosition(outputLineIndex, 0);
	}

	private getInputEndOffsetOfOutputLineIndex(model: ISimpleModel, modelLineNumber: number, outputLineIndex: number): number {
		if (outputLineIndex + 1 === this._lineBreakData.breakOffsets.length) {
			return model.getLineMaxColumn(modelLineNumber) - 1;
		}
		return this._lineBreakData.getInputOffsetOfOutputPosition(outputLineIndex + 1, 0);
	}

	public getViewLineContent(model: ISimpleModel, modelLineNumber: number, outputLineIndex: number): string {
		if (!this._isVisible) {
			throw new Error('Not supported');
		}

		// These offsets refer to model text with injected text.
		const startOffset = outputLineIndex > 0 ? this._lineBreakData.breakOffsets[outputLineIndex - 1] : 0;
		const endOffset = outputLineIndex < this._lineBreakData.breakOffsets.length
			? this._lineBreakData.breakOffsets[outputLineIndex]
			// This case might not be possible anyway, but we clamp the value to be on the safe side.
			: this._lineBreakData.breakOffsets[this._lineBreakData.breakOffsets.length - 1];

		let r: string;
		if (this._lineBreakData.injectionOffsets !== null) {
			const injectedTexts = this._lineBreakData.injectionOffsets.map((offset, idx) => new LineInjectedText(0, 0, offset + 1, this._lineBreakData.injectionOptions![idx], 0));
			r = LineInjectedText.applyInjectedText(model.getLineContent(modelLineNumber), injectedTexts).substring(startOffset, endOffset);
		} else {
			r = model.getValueInRange({
				startLineNumber: modelLineNumber,
				startColumn: startOffset + 1,
				endLineNumber: modelLineNumber,
				endColumn: endOffset + 1
			});
		}

		if (outputLineIndex > 0) {
			r = spaces(this._lineBreakData.wrappedTextIndentLength) + r;
		}

		return r;
	}

	public getViewLineLength(model: ISimpleModel, modelLineNumber: number, outputLineIndex: number): number {
		// TODO @hediet make this method a member of LineBreakData.
		if (!this._isVisible) {
			throw new Error('Not supported');
		}

		// These offsets refer to model text with injected text.
		const startOffset = outputLineIndex > 0 ? this._lineBreakData.breakOffsets[outputLineIndex - 1] : 0;
		const endOffset = outputLineIndex < this._lineBreakData.breakOffsets.length
			? this._lineBreakData.breakOffsets[outputLineIndex]
			// This case might not be possible anyway, but we clamp the value to be on the safe side.
			: this._lineBreakData.breakOffsets[this._lineBreakData.breakOffsets.length - 1];

		let r = endOffset - startOffset;

		if (outputLineIndex > 0) {
			r = this._lineBreakData.wrappedTextIndentLength + r;
		}

		return r;
	}

	public getViewLineMinColumn(_model: ITextModel, _modelLineNumber: number, outputLineIndex: number): number {
		if (!this._isVisible) {
			throw new Error('Not supported');
		}
		return this._getViewLineMinColumn(outputLineIndex);
	}

	private _getViewLineMinColumn(outputLineIndex: number): number {
		if (outputLineIndex > 0) {
			return this._lineBreakData.wrappedTextIndentLength + 1;
		}
		return 1;
	}

	public getViewLineMaxColumn(model: ISimpleModel, modelLineNumber: number, outputLineIndex: number): number {
		if (!this._isVisible) {
			throw new Error('Not supported');
		}
		return this.getViewLineLength(model, modelLineNumber, outputLineIndex) + 1;
	}

	public getViewLineData(model: ISimpleModel, modelLineNumber: number, outputLineIndex: number): ViewLineData {
		if (!this._isVisible) {
			throw new Error('Not supported');
		}
		const lineBreakData = this._lineBreakData;
		const deltaStartIndex = (outputLineIndex > 0 ? lineBreakData.wrappedTextIndentLength : 0);

		const injectionOffsets = lineBreakData.injectionOffsets;
		const injectionOptions = lineBreakData.injectionOptions;

		let lineContent: string;
		let tokens: IViewLineTokens;
		let inlineDecorations: null | SingleLineInlineDecoration[];
		if (injectionOffsets) {
			const lineTokens = model.getLineTokens(modelLineNumber).withInserted(injectionOffsets.map((offset, idx) => ({
				offset,
				text: injectionOptions![idx].content,
				tokenMetadata: LineTokens.defaultTokenMetadata
			})));

			const lineStartOffsetInUnwrappedLine = outputLineIndex > 0 ? lineBreakData.breakOffsets[outputLineIndex - 1] : 0;
			const lineEndOffsetInUnwrappedLine = lineBreakData.breakOffsets[outputLineIndex];

			lineContent = lineTokens.getLineContent().substring(lineStartOffsetInUnwrappedLine, lineEndOffsetInUnwrappedLine);
			tokens = lineTokens.sliceAndInflate(lineStartOffsetInUnwrappedLine, lineEndOffsetInUnwrappedLine, deltaStartIndex);
			inlineDecorations = new Array<SingleLineInlineDecoration>();

			let totalInjectedTextLengthBefore = 0;
			for (let i = 0; i < injectionOffsets.length; i++) {
				const length = injectionOptions![i].content.length;
				const injectedTextStartOffsetInUnwrappedLine = injectionOffsets[i] + totalInjectedTextLengthBefore;
				const injectedTextEndOffsetInUnwrappedLine = injectionOffsets[i] + totalInjectedTextLengthBefore + length;

				if (injectedTextStartOffsetInUnwrappedLine > lineEndOffsetInUnwrappedLine) {
					// Injected text only starts in later wrapped lines.
					break;
				}

				if (lineStartOffsetInUnwrappedLine < injectedTextEndOffsetInUnwrappedLine) {
					// Injected text ends after or in this line (but also starts in or before this line).
					const options = injectionOptions![i];
					if (options.inlineClassName) {
						const offset = (outputLineIndex > 0 ? lineBreakData.wrappedTextIndentLength : 0);
						const start = offset + Math.max(injectedTextStartOffsetInUnwrappedLine - lineStartOffsetInUnwrappedLine, 0);
						const end = offset + Math.min(injectedTextEndOffsetInUnwrappedLine - lineStartOffsetInUnwrappedLine, lineEndOffsetInUnwrappedLine);
						if (start !== end) {
							inlineDecorations.push(new SingleLineInlineDecoration(start, end, options.inlineClassName, options.inlineClassNameAffectsLetterSpacing!));
						}
					}
				}

				totalInjectedTextLengthBefore += length;
			}
		} else {
			const startOffset = this.getInputStartOffsetOfOutputLineIndex(outputLineIndex);
			const endOffset = this.getInputEndOffsetOfOutputLineIndex(model, modelLineNumber, outputLineIndex);
			const lineTokens = model.getLineTokens(modelLineNumber);
			lineContent = model.getValueInRange({
				startLineNumber: modelLineNumber,
				startColumn: startOffset + 1,
				endLineNumber: modelLineNumber,
				endColumn: endOffset + 1
			});
			tokens = lineTokens.sliceAndInflate(startOffset, endOffset, deltaStartIndex);
			inlineDecorations = null;
		}

		if (outputLineIndex > 0) {
			lineContent = spaces(lineBreakData.wrappedTextIndentLength) + lineContent;
		}

		const minColumn = (outputLineIndex > 0 ? lineBreakData.wrappedTextIndentLength + 1 : 1);
		const maxColumn = lineContent.length + 1;
		const continuesWithWrappedLine = (outputLineIndex + 1 < this.getViewLineCount());
		const startVisibleColumn = (outputLineIndex === 0 ? 0 : lineBreakData.breakOffsetsVisibleColumn[outputLineIndex - 1]);

		return new ViewLineData(
			lineContent,
			continuesWithWrappedLine,
			minColumn,
			maxColumn,
			startVisibleColumn,
			tokens,
			inlineDecorations
		);
	}

	public getViewLinesData(model: ITextModel, modelLineNumber: number, fromOuputLineIndex: number, toOutputLineIndex: number, globalStartIndex: number, needed: boolean[], result: Array<ViewLineData | null>): void {
		if (!this._isVisible) {
			throw new Error('Not supported');
		}

		for (let outputLineIndex = fromOuputLineIndex; outputLineIndex < toOutputLineIndex; outputLineIndex++) {
			let globalIndex = globalStartIndex + outputLineIndex - fromOuputLineIndex;
			if (!needed[globalIndex]) {
				result[globalIndex] = null;
				continue;
			}
			result[globalIndex] = this.getViewLineData(model, modelLineNumber, outputLineIndex);
		}
	}

	public getModelColumnOfViewPosition(outputLineIndex: number, outputColumn: number): number {
		if (!this._isVisible) {
			throw new Error('Not supported');
		}
		let adjustedColumn = outputColumn - 1;
		if (outputLineIndex > 0) {
			if (adjustedColumn < this._lineBreakData.wrappedTextIndentLength) {
				adjustedColumn = 0;
			} else {
				adjustedColumn -= this._lineBreakData.wrappedTextIndentLength;
			}
		}
		return this._lineBreakData.getInputOffsetOfOutputPosition(outputLineIndex, adjustedColumn) + 1;
	}

	public getViewPositionOfModelPosition(deltaLineNumber: number, inputColumn: number, affinity: PositionAffinity = PositionAffinity.None): Position {
		if (!this._isVisible) {
			throw new Error('Not supported');
		}
		let r = this._lineBreakData.getOutputPositionOfInputOffset(inputColumn - 1, affinity);
		let outputLineIndex = r.outputLineIndex;
		let outputColumn = r.outputOffset + 1;

		if (outputLineIndex > 0) {
			outputColumn += this._lineBreakData.wrappedTextIndentLength;
		}

		//		console.log('in -> out ' + deltaLineNumber + ',' + inputColumn + ' ===> ' + (deltaLineNumber+outputLineIndex) + ',' + outputColumn);
		return new Position(deltaLineNumber + outputLineIndex, outputColumn);
	}

	public getViewLineNumberOfModelPosition(deltaLineNumber: number, inputColumn: number): number {
		if (!this._isVisible) {
			throw new Error('Not supported');
		}
		const r = this._lineBreakData.getOutputPositionOfInputOffset(inputColumn - 1);
		return (deltaLineNumber + r.outputLineIndex);
	}

	public normalizePosition(model: ISimpleModel, modelLineNumber: number, outputLineIndex: number, outputPosition: Position, affinity: PositionAffinity): Position {
		if (this._lineBreakData.injectionOffsets !== null) {
			const baseViewLineNumber = outputPosition.lineNumber - outputLineIndex;
			const offsetInUnwrappedLine = this._lineBreakData.outputPositionToOffsetInUnwrappedLine(outputLineIndex, outputPosition.column - 1);
			const normalizedOffsetInUnwrappedLine = this._lineBreakData.normalizeOffsetAroundInjections(offsetInUnwrappedLine, affinity);
			if (normalizedOffsetInUnwrappedLine !== offsetInUnwrappedLine) {
				// injected text caused a change
				return this._lineBreakData.getOutputPositionOfOffsetInUnwrappedLine(normalizedOffsetInUnwrappedLine, affinity).toPosition(baseViewLineNumber, this._lineBreakData.wrappedTextIndentLength);
			}
		}

		if (affinity === PositionAffinity.Left) {
			if (outputLineIndex > 0 && outputPosition.column === this._getViewLineMinColumn(outputLineIndex)) {
				return new Position(outputPosition.lineNumber - 1, this.getViewLineMaxColumn(model, modelLineNumber, outputLineIndex - 1));
			}
		}
		else if (affinity === PositionAffinity.Right) {
			const maxOutputLineIndex = this.getViewLineCount() - 1;
			if (outputLineIndex < maxOutputLineIndex && outputPosition.column === this.getViewLineMaxColumn(model, modelLineNumber, outputLineIndex)) {
				return new Position(outputPosition.lineNumber + 1, this._getViewLineMinColumn(outputLineIndex + 1));
			}
		}

		return outputPosition;
	}

	public getInjectedTextAt(outputLineIndex: number, outputColumn: number): InjectedText | null {
		return this._lineBreakData.getInjectedText(outputLineIndex, outputColumn - 1);
	}
}

let _spaces: string[] = [''];
function spaces(count: number): string {
	if (count >= _spaces.length) {
		for (let i = 1; i <= count; i++) {
			_spaces[i] = _makeSpaces(i);
		}
	}
	return _spaces[count];
}
function _makeSpaces(count: number): string {
	return new Array(count + 1).join(' ');
}

function createModelLineProjection(lineBreakData: LineBreakData | null, isVisible: boolean): IModelLineProjection {
	if (lineBreakData === null) {
		// No mapping needed
		if (isVisible) {
			return IdentityModelLineProjection.INSTANCE;
		}
		return HiddenModelLineProjection.INSTANCE;
	} else {
		return new ModelLineProjection(lineBreakData, isVisible);
	}
}

export class IdentityCoordinatesConverter implements ICoordinatesConverter {

	private readonly _lines: IdentityLinesCollection;

	constructor(lines: IdentityLinesCollection) {
		this._lines = lines;
	}

	private _validPosition(pos: Position): Position {
		return this._lines.model.validatePosition(pos);
	}

	private _validRange(range: Range): Range {
		return this._lines.model.validateRange(range);
	}

	// View -> Model conversion and related methods

	public convertViewPositionToModelPosition(viewPosition: Position): Position {
		return this._validPosition(viewPosition);
	}

	public convertViewRangeToModelRange(viewRange: Range): Range {
		return this._validRange(viewRange);
	}

	public validateViewPosition(_viewPosition: Position, expectedModelPosition: Position): Position {
		return this._validPosition(expectedModelPosition);
	}

	public validateViewRange(_viewRange: Range, expectedModelRange: Range): Range {
		return this._validRange(expectedModelRange);
	}

	// Model -> View conversion and related methods

	public convertModelPositionToViewPosition(modelPosition: Position): Position {
		return this._validPosition(modelPosition);
	}

	public convertModelRangeToViewRange(modelRange: Range): Range {
		return this._validRange(modelRange);
	}

	public modelPositionIsVisible(modelPosition: Position): boolean {
		const lineCount = this._lines.model.getLineCount();
		if (modelPosition.lineNumber < 1 || modelPosition.lineNumber > lineCount) {
			// invalid arguments
			return false;
		}
		return true;
	}

	public getModelLineViewLineCount(modelLineNumber: number): number {
		return 1;
	}

	public getViewLineNumberOfModelPosition(modelLineNumber: number, modelColumn: number): number {
		return modelLineNumber;
	}
}

export class IdentityLinesCollection implements IViewModelLinesCollection {

	public readonly model: ITextModel;

	constructor(model: ITextModel) {
		this.model = model;
	}

	public dispose(): void {
	}

	public createCoordinatesConverter(): ICoordinatesConverter {
		return new IdentityCoordinatesConverter(this);
	}

	public getHiddenAreas(): Range[] {
		return [];
	}

	public setHiddenAreas(_ranges: Range[]): boolean {
		return false;
	}

	public setTabSize(_newTabSize: number): boolean {
		return false;
	}

	public setWrappingSettings(_fontInfo: FontInfo, _wrappingStrategy: 'simple' | 'advanced', _wrappingColumn: number, _wrappingIndent: WrappingIndent): boolean {
		return false;
	}

	public createLineBreaksComputer(): ILineBreaksComputer {
		let result: null[] = [];
		return {
			addRequest: (lineText: string, injectedText: LineInjectedText[] | null, previousLineBreakData: LineBreakData | null) => {
				result.push(null);
			},
			finalize: () => {
				return result;
			}
		};
	}

	public onModelFlushed(): void {
	}

	public onModelLinesDeleted(_versionId: number | null, fromLineNumber: number, toLineNumber: number): viewEvents.ViewLinesDeletedEvent | null {
		return new viewEvents.ViewLinesDeletedEvent(fromLineNumber, toLineNumber);
	}

	public onModelLinesInserted(_versionId: number | null, fromLineNumber: number, toLineNumber: number, lineBreaks: (LineBreakData | null)[]): viewEvents.ViewLinesInsertedEvent | null {
		return new viewEvents.ViewLinesInsertedEvent(fromLineNumber, toLineNumber);
	}

	public onModelLineChanged(_versionId: number | null, lineNumber: number, lineBreakData: LineBreakData | null): [boolean, viewEvents.ViewLinesChangedEvent | null, viewEvents.ViewLinesInsertedEvent | null, viewEvents.ViewLinesDeletedEvent | null] {
		return [false, new viewEvents.ViewLinesChangedEvent(lineNumber, lineNumber), null, null];
	}

	public acceptVersionId(_versionId: number): void {
	}

	public getViewLineCount(): number {
		return this.model.getLineCount();
	}

	public getActiveIndentGuide(viewLineNumber: number, _minLineNumber: number, _maxLineNumber: number): IActiveIndentGuideInfo {
		return {
			startLineNumber: viewLineNumber,
			endLineNumber: viewLineNumber,
			indent: 0
		};
	}

	public getViewLinesBracketGuides(startLineNumber: number, endLineNumber: number, activePosition: IPosition | null): IndentGuide[][] {
		return new Array(endLineNumber - startLineNumber + 1).fill([]);
	}

	public getViewLinesIndentGuides(viewStartLineNumber: number, viewEndLineNumber: number): number[] {
		const viewLineCount = viewEndLineNumber - viewStartLineNumber + 1;
		let result = new Array<number>(viewLineCount);
		for (let i = 0; i < viewLineCount; i++) {
			result[i] = 0;
		}
		return result;
	}

	public getViewLineContent(viewLineNumber: number): string {
		return this.model.getLineContent(viewLineNumber);
	}

	public getViewLineLength(viewLineNumber: number): number {
		return this.model.getLineLength(viewLineNumber);
	}

	public getViewLineMinColumn(viewLineNumber: number): number {
		return this.model.getLineMinColumn(viewLineNumber);
	}

	public getViewLineMaxColumn(viewLineNumber: number): number {
		return this.model.getLineMaxColumn(viewLineNumber);
	}

	public getViewLineData(viewLineNumber: number): ViewLineData {
		let lineTokens = this.model.getLineTokens(viewLineNumber);
		let lineContent = lineTokens.getLineContent();
		return new ViewLineData(
			lineContent,
			false,
			1,
			lineContent.length + 1,
			0,
			lineTokens.inflate(),
			null
		);
	}

	public getViewLinesData(viewStartLineNumber: number, viewEndLineNumber: number, needed: boolean[]): Array<ViewLineData | null> {
		const lineCount = this.model.getLineCount();
		viewStartLineNumber = Math.min(Math.max(1, viewStartLineNumber), lineCount);
		viewEndLineNumber = Math.min(Math.max(1, viewEndLineNumber), lineCount);

		let result: Array<ViewLineData | null> = [];
		for (let lineNumber = viewStartLineNumber; lineNumber <= viewEndLineNumber; lineNumber++) {
			let idx = lineNumber - viewStartLineNumber;
			if (!needed[idx]) {
				result[idx] = null;
			}
			result[idx] = this.getViewLineData(lineNumber);
		}

		return result;
	}

	public getDecorationsInRange(range: Range, ownerId: number, filterOutValidation: boolean): IModelDecoration[] {
		return this.model.getDecorationsInRange(range, ownerId, filterOutValidation);
	}

	normalizePosition(position: Position, affinity: PositionAffinity): Position {
		return this.model.normalizePosition(position, affinity);
	}

	public getLineIndentColumn(lineNumber: number): number {
		return this.model.getLineIndentColumn(lineNumber);
	}

	public getInjectedTextAt(position: Position): InjectedText | null {
		// Identity lines collection does not support injected text.
		return null;
	}
}
