/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as azdata from 'azdata';
import * as vscode from 'vscode';
import { MigrationWizardPage } from '../models/migrationWizardPage';
import { MigrationMode, MigrationStateModel, MigrationTargetType, StateChangeEvent } from '../models/stateMachine';
import * as constants from '../constants/strings';
import * as styles from '../constants/styles';

export class MigrationModePage extends MigrationWizardPage {
	private _view!: azdata.ModelView;
	private _onlineButton!: azdata.RadioButtonComponent;
	private _offlineButton!: azdata.RadioButtonComponent;
	private _originalMigrationMode!: MigrationMode;
	private _disposables: vscode.Disposable[] = [];

	constructor(wizard: azdata.window.Wizard, migrationStateModel: MigrationStateModel) {
		super(
			wizard,
			azdata.window.createWizardPage(constants.DATABASE_BACKUP_MIGRATION_MODE_LABEL, 'MigrationModePage'),
			migrationStateModel);
		this.migrationStateModel._databaseBackup.migrationMode = this.migrationStateModel._databaseBackup.migrationMode || MigrationMode.ONLINE;
	}

	protected async registerContent(view: azdata.ModelView): Promise<void> {
		this._view = view;

		const pageDescription = {
			title: '',
			component: view.modelBuilder.text()
				.withProps({
					value: constants.DATABASE_BACKUP_MIGRATION_MODE_DESCRIPTION,
					CSSStyles: { ...styles.BODY_CSS, 'margin': '0' }
				}).component()
		};

		const form = view.modelBuilder.formContainer()
			.withFormItems([
				pageDescription,
				this.migrationModeContainer()])
			.withProps({ CSSStyles: { 'padding-top': '0' } })
			.component();

		this._disposables.push(
			this._view.onClosed(
				e => this._disposables.forEach(
					d => { try { d.dispose(); } catch { } })));

		await view.initializeModel(form);
	}

	public async onPageEnter(pageChangeInfo: azdata.window.WizardPageChangeInfo): Promise<void> {
		if (pageChangeInfo.newPage < pageChangeInfo.lastPage) {
			return;
		}

		const isSqlDbTarget = this.migrationStateModel._targetType === MigrationTargetType.SQLDB;
		this._onlineButton.enabled = !isSqlDbTarget;
		if (isSqlDbTarget) {
			this.migrationStateModel._databaseBackup.migrationMode = MigrationMode.OFFLINE;
			this._offlineButton.checked = true;
			await this._offlineButton.focus();
		}
		this._originalMigrationMode = this.migrationStateModel._databaseBackup.migrationMode;
		this.wizard.registerNavigationValidator((e) => true);
	}

	public async onPageLeave(pageChangeInfo: azdata.window.WizardPageChangeInfo): Promise<void> {
		if (this._originalMigrationMode !== this.migrationStateModel._databaseBackup.migrationMode) {
			this.migrationStateModel.refreshDatabaseBackupPage = true;
		}
		this.wizard.registerNavigationValidator((e) => true);
	}

	protected async handleStateChange(e: StateChangeEvent): Promise<void> {
	}

	private migrationModeContainer(): azdata.FormComponent {
		const buttonGroup = 'migrationMode';
		this._onlineButton = this._view.modelBuilder.radioButton()
			.withProps({
				label: constants.DATABASE_BACKUP_MIGRATION_MODE_ONLINE_LABEL,
				name: buttonGroup,
				checked: this.migrationStateModel._databaseBackup.migrationMode === MigrationMode.ONLINE,
				CSSStyles: { ...styles.LABEL_CSS, },
			}).component();
		const onlineDescription = this._view.modelBuilder.text()
			.withProps({
				value: constants.DATABASE_BACKUP_MIGRATION_MODE_ONLINE_DESCRIPTION,
				CSSStyles: { ...styles.NOTE_CSS, 'margin-left': '20px' }
			}).component();
		this._disposables.push(
			this._onlineButton.onDidChangeCheckedState(checked => {
				if (checked) {
					this.migrationStateModel._databaseBackup.migrationMode = MigrationMode.ONLINE;
				}
			}));

		this._offlineButton = this._view.modelBuilder.radioButton()
			.withProps({
				label: constants.DATABASE_BACKUP_MIGRATION_MODE_OFFLINE_LABEL,
				name: buttonGroup,
				checked: this.migrationStateModel._databaseBackup.migrationMode === MigrationMode.OFFLINE,
				CSSStyles: { ...styles.LABEL_CSS, 'margin-top': '12px' },
			}).component();
		const offlineDescription = this._view.modelBuilder.text()
			.withProps({
				value: constants.DATABASE_BACKUP_MIGRATION_MODE_OFFLINE_DESCRIPTION,
				CSSStyles: { ...styles.NOTE_CSS, 'margin-left': '20px' }
			}).component();
		this._disposables.push(
			this._offlineButton.onDidChangeCheckedState(checked => {
				if (checked) {
					this.migrationStateModel._databaseBackup.migrationMode = MigrationMode.OFFLINE;
				}
			}));

		const flexContainer = this._view.modelBuilder.flexContainer()
			.withItems([
				this._onlineButton,
				onlineDescription,
				this._offlineButton,
				offlineDescription]
			).withLayout({ flexFlow: 'column' })
			.component();

		return { component: flexContainer };
	}
}
