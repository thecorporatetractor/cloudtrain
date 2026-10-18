// Writes the files the Kusto.Language T4 templates would produce (see codegen.csproj).
using System;
using System.IO;
using Kusto.Language.Generator;
using Kusto.Language.Generators;

internal static class Program
{
    private static int Main(string[] args)
    {
        if (args.Length != 1)
        {
            Console.Error.WriteLine("usage: codegen <Kusto-Query-Language>/src/Kusto.Language");
            return 2;
        }

        var root = args[0];
        void Write(string path, string text)
        {
            File.WriteAllText(Path.Combine(root, path), text);
            Console.WriteLine($"generated {path}");
        }

        Write("Syntax/CodeGen/GeneratedSyntaxNodes.cs",
            SyntaxNodeGenerator.Generate(SyntaxNodeInfos.All, SyntaxNodeInfos.KnownTypes));
        foreach (var (name, infos) in new[]
                 {
                     ("AriaBridge", typeof(AriaBridgeCommandInfos)), ("ClusterManager", typeof(ClusterManagerCommandInfos)),
                     ("DataManager", typeof(DataManagerCommandInfos)), ("Engine", typeof(EngineCommandInfos))
                 })
        {
            Write($"Parser/CodeGen/{name}CommandGrammar.cs", new CommandGenerator().GenerateParser($"{name}CommandGrammar", infos));
            Write($"Parser/CodeGen/{name}Commands.cs", new CommandGenerator().GenerateSymbols($"{name}Commands", infos));
        }

        return 0;
    }
}
