import type { IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription } from 'n8n-workflow';
export declare class AIStateHandler implements INodeType {
    description: INodeTypeDescription;
    static cleanJsonResponse(jsonString: string): string;
    static parseToolResult(toolResult: any): any;
    static formatStateModelDescription(stateModel: Record<string, any>): string;
    execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]>;
}
