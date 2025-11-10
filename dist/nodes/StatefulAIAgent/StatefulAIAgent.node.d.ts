import type { IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription } from 'n8n-workflow';
export declare class StatefulAIAgent implements INodeType {
    description: INodeTypeDescription;
    static formatConversationHistory(history: Array<{
        role: string;
        message: string;
    }>): string;
    static cleanJsonResponse(jsonString: string): string;
    static prepareStateFieldsForTemplate(stateModel: Record<string, string>, state: Record<string, any>): Record<string, any>;
    static parseToolResult(toolResult: any): any;
    static extractStateModelStructure(stateModel: any, prefix?: string): Array<{
        path: string;
        description: string;
    }>;
    static getNestedValue(obj: any, path: string): any;
    static setNestedValue(obj: any, path: string, value: any): void;
    static mergeStateWithModel(updatedState: any, stateModel: any, currentState: Record<string, any>): Record<string, any>;
    static invokeTools(toolsToInvoke: any[], agentTools: any[], stateModel: Record<string, string>, state: Record<string, any>, stateChangedProps: string[]): Promise<{
        invokedToolNames: string[];
        toolResults: any[];
    }>;
    static validateAndExtractState(parsedResult: any, stateModel: Record<string, string>, state: Record<string, any>, prevStateModelOnly: Record<string, any>, stateChangedProps: string[], isFirstRun: boolean): string[];
    execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]>;
}
