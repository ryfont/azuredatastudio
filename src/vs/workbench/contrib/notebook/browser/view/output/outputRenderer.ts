/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button } from 'vs/base/browser/ui/button/button';
import { onUnexpectedError } from 'vs/base/common/errors';
import { DisposableStore, dispose } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { localize } from 'vs/nls';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ICellOutputViewModel, IRenderOutput, RenderOutputType } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { INotebookDelegateForOutput, IOutputTransformContribution } from 'vs/workbench/contrib/notebook/browser/view/notebookRenderingCommon';
import { OutputRendererRegistry } from 'vs/workbench/contrib/notebook/browser/view/output/rendererRegistry';

export class OutputRenderer {

	private readonly _richMimeTypeRenderers = new Map<string, IOutputTransformContribution>();

	constructor(
		private readonly notebookEditor: INotebookDelegateForOutput,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ICommandService private readonly commandservice: ICommandService,
	) {
	}
	dispose(): void {
		dispose(this._richMimeTypeRenderers.values());
		this._richMimeTypeRenderers.clear();
	}

	getContribution(preferredMimeType: string): IOutputTransformContribution | undefined {
		this._initialize();
		return this._richMimeTypeRenderers.get(preferredMimeType);
	}

	private _initialize() {
		if (this._richMimeTypeRenderers.size) {
			return;
		}
		for (const desc of OutputRendererRegistry.getOutputTransformContributions()) {
			try {
				const contribution = this.instantiationService.createInstance(desc.ctor, this.notebookEditor);
				contribution.getMimetypes().forEach(mimetype => { this._richMimeTypeRenderers.set(mimetype, contribution); });
			} catch (err) {
				onUnexpectedError(err);
			}
		}
	}

	private _renderMessage(container: HTMLElement, message: string): IRenderOutput {
		const contentNode = document.createElement('p');
		contentNode.innerText = message;
		container.appendChild(contentNode);
		return { type: RenderOutputType.Mainframe };
	}

	private _renderSearchForMimetype(container: HTMLElement, mimeType: string): IRenderOutput {
		const disposable = new DisposableStore();

		const contentNode = document.createElement('p');
		contentNode.innerText = localize('noRenderer.1', "No renderer could be found for mimetype \"{0}\", but one might be available on the Marketplace.", mimeType);

		const button = new Button(container);
		button.label = localize('noRenderer.search', 'Search Marketplace');
		button.element.style.maxWidth = `200px`;
		disposable.add(button.onDidClick(() => this.commandservice.executeCommand('workbench.extensions.search', `@tag:notebookRenderer ${mimeType}`)));
		disposable.add(button);

		container.appendChild(contentNode);
		container.appendChild(button.element);

		return {
			type: RenderOutputType.Mainframe,
			disposable,
		};
	}

	render(viewModel: ICellOutputViewModel, container: HTMLElement, preferredMimeType: string | undefined, notebookUri: URI): IRenderOutput {
		this._initialize();
		if (!viewModel.model.outputs.length) {
			return this._renderMessage(container, localize('empty', "Cell has no output"));
		}
		if (!preferredMimeType) {
			const mimeTypes = viewModel.model.outputs.map(op => op.mime);
			const mimeTypesMessage = mimeTypes.join(', ');
			return this._renderMessage(container, localize('noRenderer.2', "No renderer could be found for output. It has the following mimetypes: {0}", mimeTypesMessage));
		}
		if (!preferredMimeType || !this._richMimeTypeRenderers.has(preferredMimeType)) {
			if (preferredMimeType) {
				return this._renderSearchForMimetype(container, preferredMimeType);
			}
		}
		const renderer = this._richMimeTypeRenderers.get(preferredMimeType);
		if (!renderer) {
			return this._renderSearchForMimetype(container, preferredMimeType);
		}
		const first = viewModel.model.outputs.find(op => op.mime === preferredMimeType);
		if (!first) {
			return this._renderMessage(container, localize('empty', "Cell has no output"));
		}

		return renderer.render(viewModel, first, container, notebookUri);
	}
}
